import RfqRepository from '../repositories/RfqRepository.js';
import NotificationRepository from '../repositories/NotificationRepository.js';
import { validateTransition, RFQ_STATUSES } from '../utils/rfqStateMachine.js';
import { AppError } from '../middlewares/errorHandler.js';
import { getIO } from '../config/socket.js';
import DashboardMetricsService from './DashboardMetricsService.js';
import VendorMetricsService from './VendorMetricsService.js';
import NotificationService from './NotificationService.js';
import RealtimeService from './RealtimeService.js';
import pool from '../config/db.js';
import { buildRfqTitle, normalizeRfqItems } from '../utils/rfqItems.js';

class RfqService {
  async _emitRfqEventToUsers(userIds = [], eventName, payload = {}) {
    const normalizedIds = [...new Set((userIds || []).filter(Boolean))];
    if (!normalizedIds.length || !eventName) return;

    await Promise.allSettled([
      RealtimeService.emitToUsers(normalizedIds, eventName, {
        revision: Date.now(),
        ...payload,
      }),
      eventName !== 'rfq.feed.changed'
        ? RealtimeService.emitToUsers(normalizedIds, 'rfq.feed.changed', {
            revision: Date.now(),
            ...payload,
          })
        : Promise.resolve(),
    ]);
  }

  async _emitRfqDashboardRefresh({ vendorUserIds = [], ownerUserId = null, admin = false, payload = {} } = {}) {
    const normalizedVendorUserIds = [...new Set((vendorUserIds || []).filter(Boolean))];
    const normalizedUserIds = [...new Set([ownerUserId, ...normalizedVendorUserIds].filter(Boolean))];

    await Promise.allSettled([
      normalizedUserIds.length
        ? RealtimeService.emitToUsers(normalizedUserIds, 'rfq.updated', {
            revision: Date.now(),
            ...payload,
          })
        : Promise.resolve(),
      RealtimeService.emitDashboardMetricsChanged({
        admin,
        vendorUserIds: normalizedVendorUserIds,
        payload: {
          entity: 'rfq',
          revision: Date.now(),
          ...payload,
        },
      }),
    ]);
  }
  /**
   * Creates a new RFQ natively defaulting to DRAFT or PENDING based on input.
   */
  async createRfq(rfqData, submit = false) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    let broadcastContext = null;

    try {
      const normalizedItems = normalizeRfqItems(rfqData.items);
      const rfqTitle = buildRfqTitle(normalizedItems);
      const rfqId = await RfqRepository.createRfq({ ...rfqData, items: normalizedItems }, connection);
      
      // Log history DRAFT
      await RfqRepository.updateStatus(rfqId, null, RFQ_STATUSES.DRAFT, rfqData.user_id, 'RFQ Created', connection);

      if (submit) {
        validateTransition(RFQ_STATUSES.DRAFT, RFQ_STATUSES.PENDING);
        await RfqRepository.updateStatus(rfqId, RFQ_STATUSES.DRAFT, RFQ_STATUSES.PENDING, rfqData.user_id, 'User submitted for approval', connection);
        validateTransition(RFQ_STATUSES.PENDING, RFQ_STATUSES.APPROVED);
        await RfqRepository.updateStatus(
          rfqId,
          RFQ_STATUSES.PENDING,
          RFQ_STATUSES.APPROVED,
          rfqData.user_id,
          'RFQ auto-approved on submission',
          connection
        );

        const vendors = await RfqRepository.getMatchingVendors(rfqData.category_id, connection);
        validateTransition(RFQ_STATUSES.APPROVED, RFQ_STATUSES.BROADCASTED);
        await RfqRepository.updateStatus(
          rfqId,
          RFQ_STATUSES.APPROVED,
          RFQ_STATUSES.BROADCASTED,
          rfqData.user_id,
          `RFQ auto-broadcasted to ${vendors.length} matching vendors`,
          connection
        );

        broadcastContext = {
          rfqId,
          rfqTitle,
          vendors
        };
      }

      await connection.commit();
      DashboardMetricsService.invalidateAdminDashboard();

      if (submit) {
        try {
          const reviewers = broadcastContext?.vendors || [];
          const rfq = broadcastContext || { rfqId, rfqTitle, vendors: reviewers };
          const io = getIO();
          await Promise.allSettled(
            reviewers.map(async (vendor) => {
              await NotificationRepository.create({
                userId: vendor.user_id,
                type: 'RFQ_MATCH',
                titleAr: 'طلب RFQ جديد بانتظار المراجعة',
                titleEn: 'New RFQ opportunity in your category',
                contentAr: `يوجد طلب جديد بعنوان "${rfq?.rfqTitle || 'RFQ'}" يحتاج مراجعة.`,
                contentEn: `A new RFQ titled "${rfq?.rfqTitle || 'RFQ'}" is now available in your leads center.`
              });

              await io.to(vendor.user_id.toString()).emit('new_rfq', {
                type: 'success',
                messageAr: `يوجد طلب RFQ جديد بعنوان "${rfq?.rfqTitle || 'RFQ'}" بانتظار المراجعة.`,
                messageEn: `New Lead: ${rfq?.rfqTitle || 'RFQ'} matches your categories.`,
                rfq_id: rfq?.rfqId
              });
            })
          );

          await Promise.allSettled([
            this._emitRfqEventToUsers(
              reviewers.map((vendor) => vendor.user_id),
              'rfq.created',
              {
                rfqId,
                status: RFQ_STATUSES.BROADCASTED
              }
            ),
            this._emitRfqDashboardRefresh({
              vendorUserIds: reviewers.map((vendor) => vendor.user_id),
              ownerUserId: rfqData.user_id,
              admin: true,
              payload: {
                rfqId,
                status: RFQ_STATUSES.BROADCASTED
              }
            }),
            RealtimeService.emitToRole('admin', 'rfq.created', {
              rfqId,
              status: RFQ_STATUSES.BROADCASTED,
              revision: Date.now()
            })
          ]);
        } catch (notifyError) {
          console.warn('RFQ vendor notification failed:', notifyError.message);
        }
      }

      return rfqId;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Broadcasts an approved RFQ to relevant vendors.
   * Finds matching vendors via the category junction.
   */
  async broadcastRfq(rfqId, adminId) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.findById(rfqId, connection);
      if (!rfq) throw new AppError('RFQ not found', 404);

      if (rfq.status === RFQ_STATUSES.PENDING) {
        validateTransition(RFQ_STATUSES.PENDING, RFQ_STATUSES.APPROVED);
        await RfqRepository.updateStatus(
          rfq.id,
          RFQ_STATUSES.PENDING,
          RFQ_STATUSES.APPROVED,
          adminId,
          'RFQ approved during broadcast review',
          connection
        );
        rfq.status = RFQ_STATUSES.APPROVED;
      }

      validateTransition(rfq.status, RFQ_STATUSES.BROADCASTED);

      // Find relevant vendors
      const vendors = await RfqRepository.getMatchingVendors(rfq.category_id, connection);
      
      // Update status
      await RfqRepository.updateStatus(
        rfq.id,
        rfq.status,
        RFQ_STATUSES.BROADCASTED,
        adminId,
        `Broadcasted to ${vendors.length} matching vendors`,
        connection
      );

      await connection.commit();
      DashboardMetricsService.invalidateAdminDashboard();

      // Emit realtime Socket + persist notifications for every matching vendor user.
      try {
        const io = getIO();
        const notifyJobs = vendors.map(async (vendor) => {
          await NotificationRepository.create({
            userId: vendor.user_id,
            type: 'RFQ_MATCH',
            titleAr: 'فرصة RFQ جديدة في تخصصك',
            titleEn: 'New RFQ opportunity in your category',
            contentAr: `يوجد طلب جديد بعنوان "${rfq.title}" متاح الآن في مركز الفرص.`,
            contentEn: `A new RFQ titled "${rfq.title}" is now available in your leads center.`
          }, connection);

          await io.to(vendor.user_id.toString()).emit('new_rfq', {
            messageAr: `يوجد طلب RFQ جديد بعنوان "${rfq.title}" متاح الآن في مركز الفرص.`,
            messageEn: `New Lead: ${rfq.title} matches your categories.`,
            rfq_id: rfq.id,
            type: 'success'
          });
        });
        await Promise.allSettled(notifyJobs);
        await Promise.allSettled([
          this._emitRfqDashboardRefresh({
            vendorUserIds: vendors.map((vendor) => vendor.user_id),
            ownerUserId: rfq.user_id,
            admin: true,
            payload: {
              rfqId: rfq.id,
              status: RFQ_STATUSES.BROADCASTED
            }
          }),
          RealtimeService.emitToRole('admin', 'rfq.created', {
            rfqId: rfq.id,
            status: RFQ_STATUSES.BROADCASTED,
            revision: Date.now()
          })
        ]);
      } catch (e) {
         console.warn('Socket emit failed natively:', e.message);
      }
      
      return vendors.length;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async rejectRfq(rfqId, adminId) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.findById(rfqId, connection);
      if (!rfq) throw new AppError('RFQ not found', 404);

      if (rfq.status === RFQ_STATUSES.REJECTED) {
        throw new AppError('RFQ is already rejected.', 400);
      }

      validateTransition(rfq.status, RFQ_STATUSES.REJECTED);

      await RfqRepository.updateStatus(
        rfq.id,
        rfq.status,
        RFQ_STATUSES.REJECTED,
        adminId,
        'RFQ rejected during moderation',
        connection
      );

      await connection.commit();
      DashboardMetricsService.invalidateAdminDashboard();

      await Promise.allSettled([
        this._emitRfqDashboardRefresh({
          ownerUserId: rfq.user_id,
          admin: true,
          payload: {
            rfqId: rfq.id,
            status: RFQ_STATUSES.REJECTED
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId: rfq.id,
          status: RFQ_STATUSES.REJECTED,
          revision: Date.now()
        })
      ]);

      return {
        rfqId: rfq.id,
        status: RFQ_STATUSES.REJECTED
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Vendor submits an offer on a BROADCASTED or OPEN lead.
   * Employs the First-Come-Locking system via DB updates to prevent race conditions.
   */
  async submitOffer(rfqId, vendorId, actorUserId, payload) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.findById(rfqId, connection);
      if (!rfq) throw new AppError('RFQ not found', 404);

      // Edge Case: Check Expiration
      if (rfq.expiration_time && new Date() > new Date(rfq.expiration_time)) {
        throw new AppError('This RFQ has expired.', 400);
      }

      // Edge Case: Responder Limits - We use a targeted UPDATE to natively confirm capacity atomically
      const capacityAvailable = await RfqRepository.incrementResponder(rfqId, connection);
      if (!capacityAvailable) {
        throw new AppError('Max response limit reached for this RFQ.', 400); // 400 triggers our client EdgeCaseHandler natively
      }

      // If status is BROADCASTED -> change to OPEN when first vendor responds
      if (rfq.status === RFQ_STATUSES.BROADCASTED) {
        validateTransition(RFQ_STATUSES.BROADCASTED, RFQ_STATUSES.OPEN);
        await RfqRepository.updateStatus(
          rfqId,
          RFQ_STATUSES.BROADCASTED,
          RFQ_STATUSES.OPEN,
          actorUserId,
          'Initial vendor locked access',
          connection
        );
      }

      // Insert Offer record
      const [offerRes] = await connection.execute(
        `INSERT INTO rfq_offers (rfq_id, vendor_id, offered_price, delivery_time, notes, status) 
         VALUES (:rfqId, :vendorId, :offeredPrice, :deliveryTime, :notes, 'PENDING')`,
        { 
          rfqId, 
          vendorId, 
          offeredPrice: payload.offered_price, 
          deliveryTime: payload.delivery_time, 
          notes: payload.notes 
        }
      );

      // Log assignment
      await RfqRepository.logVendorAction(rfqId, vendorId, 'RESPONDED', connection);

      await connection.commit();
      VendorMetricsService.invalidateVendor(vendorId);
      DashboardMetricsService.invalidateAdminDashboard();
      await Promise.allSettled([
        this._emitRfqDashboardRefresh({
          ownerUserId: rfq.user_id,
          admin: true,
          payload: {
            rfqId,
            status: rfq.status === RFQ_STATUSES.BROADCASTED ? RFQ_STATUSES.OPEN : rfq.status
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId,
          status: rfq.status === RFQ_STATUSES.BROADCASTED ? RFQ_STATUSES.OPEN : rfq.status,
          revision: Date.now()
        })
      ]);
      return offerRes.insertId;
    } catch (err) {
      await connection.rollback();
      throw err; // Natively bubble up to Edge Case middleware wrapper.
    } finally {
      connection.release();
    }
  }

  async declineRfq(rfqId, vendorId, actorUser) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.getByIdForVendor(rfqId, vendorId, connection);
      if (!rfq) throw new AppError('RFQ not found or not accessible.', 404);

      const terminalStatuses = [
        RFQ_STATUSES.COMPLETED,
        RFQ_STATUSES.CANCELED,
        RFQ_STATUSES.EXPIRED
      ];

      if (terminalStatuses.includes(rfq.status)) {
        throw new AppError('This RFQ can no longer be declined.', 400);
      }

      const [existingOffers] = await connection.execute(
        `SELECT id
         FROM rfq_offers
         WHERE rfq_id = :rfqId
           AND vendor_id = :vendorId
         LIMIT 1`,
        { rfqId, vendorId }
      );

      if (existingOffers.length > 0) {
        throw new AppError('You already submitted an offer for this RFQ.', 400);
      }

      const [existingChats] = await connection.execute(
        `SELECT id
         FROM conversations
         WHERE related_rfq_id = :rfqId
           AND vendor_id = :vendorId
           AND COALESCE(status, 'active') NOT IN ('closed', 'archived')
         LIMIT 1`,
        { rfqId, vendorId }
      );

      if (existingChats.length > 0) {
        throw new AppError('You already started a conversation for this RFQ.', 400);
      }

      const alreadyDeclined = await RfqRepository.hasVendorAction(rfqId, vendorId, 'DECLINED', connection);
      if (!alreadyDeclined) {
        await RfqRepository.logVendorAction(rfqId, vendorId, 'DECLINED', connection);
      }

      await connection.commit();
      VendorMetricsService.invalidateVendor(vendorId);
      DashboardMetricsService.invalidateAdminDashboard();

      await Promise.allSettled([
        this._emitRfqDashboardRefresh({
          ownerUserId: rfq.user_id,
          admin: true,
          payload: {
            rfqId,
            status: rfq.status
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId,
          status: rfq.status,
          revision: Date.now()
        })
      ]);

      return {
        rfq_id: rfqId,
        vendor_id: vendorId,
        action: 'DECLINED',
        declined_by_user_id: actorUser?.id || null
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Accepts a specific vendor offer, then closes the RFQ as COMPLETED.
   * This matches the buyer action semantics in the current product UX:
   * choosing a winner should finalize the RFQ rather than keep it open.
   */
  async acceptOffer(offerId, userId) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Get offer details
      const [offerRows] = await connection.execute(
        `SELECT o.*, r.status as rfq_status, r.user_id as rfq_owner_id, vp.user_id as vendor_user_id
         FROM rfq_offers o
         JOIN rfq_requests r ON o.rfq_id = r.id
         JOIN vendor_profiles vp ON vp.id = o.vendor_id
         WHERE o.id = ?`,
        [offerId]
      );

      const offer = offerRows[0];
      if (!offer) throw new AppError('Offer not found', 404);

      // 2. Authorization: Only the RFQ owner can accept the offer
      if (offer.rfq_owner_id !== userId) {
        throw new AppError('Unauthorized: Only the requester can accept offers.', 403);
      }

      // 3. State Machine Validation
      validateTransition(offer.rfq_status, RFQ_STATUSES.ACCEPTED);

      // 4. Update Offer Status
      await connection.execute(`UPDATE rfq_offers SET status = 'ACCEPTED' WHERE id = ?`, [offerId]);

      // 5. Update RFQ Status to ACCEPTED
      await RfqRepository.updateStatus(
        offer.rfq_id,
        offer.rfq_status,
        RFQ_STATUSES.ACCEPTED,
        userId,
        `Offer #${offerId} accepted by user`,
        connection
      );

      // 6. Immediately finalize the RFQ so it becomes closed/completed in the UI
      validateTransition(RFQ_STATUSES.ACCEPTED, RFQ_STATUSES.COMPLETED);
      await RfqRepository.updateStatus(
        offer.rfq_id,
        RFQ_STATUSES.ACCEPTED,
        RFQ_STATUSES.COMPLETED,
        userId,
        `RFQ closed after accepting offer #${offerId}`,
        connection
      );

      // 7. Bulk Reject other pending offers for this RFQ (Custom business logic)
      await connection.execute(
        `UPDATE rfq_offers SET status = 'REJECTED' WHERE rfq_id = ? AND id != ? AND status = 'PENDING'`,
        [offer.rfq_id, offerId]
      );

      await connection.commit();
      VendorMetricsService.invalidateVendor(offer.vendor_id);
      DashboardMetricsService.invalidateAdminDashboard();

      // Real-time Notification to the winning vendor
      try {
        await NotificationService.createRealtimeNotification(
          {
            userId: offer.vendor_user_id,
            type: 'RFQ_MATCH',
            titleAr: 'تم قبول عرضك',
            titleEn: 'Your RFQ offer was accepted',
            contentAr: `تم قبول عرضك على طلب RFQ رقم ${offer.rfq_id}.`,
            contentEn: `Your offer for RFQ #${offer.rfq_id} has been accepted.`
          },
          {
            link: '/dashboard/vendor/rfq-offers',
            toastType: 'success',
            eventName: 'rfq_feed_updated',
            eventPayload: {
              rfqId: offer.rfq_id,
              status: RFQ_STATUSES.COMPLETED
            }
          }
        );
      } catch (e) {
         console.warn('Notification failed explicitly:', e.message);
      }

      await Promise.allSettled([
        this._emitRfqDashboardRefresh({
          vendorUserIds: offer.vendor_user_id ? [offer.vendor_user_id] : [],
          ownerUserId: offer.rfq_owner_id,
          admin: true,
          payload: {
            rfqId: offer.rfq_id,
            status: RFQ_STATUSES.COMPLETED
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId: offer.rfq_id,
          status: RFQ_STATUSES.COMPLETED,
          revision: Date.now()
        })
      ]);

      return {
        ...offer,
        rfq_status: RFQ_STATUSES.COMPLETED,
        accepted_offer_id: offerId
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async getRfqDetails(rfqId, viewer) {
    let rfq = null;
    const role = `${viewer?.role || ''}`.toUpperCase();

    if (role === 'ADMIN' || role === 'OWNER') {
      rfq = await RfqRepository.getByIdForAdmin(rfqId);
    } else if (role === 'USER') {
      rfq = await RfqRepository.getByIdForUser(rfqId, viewer.id);
    } else if (role === 'MOWARED') {
      const vendorId = viewer.vendorProfile?.id;
      if (!vendorId) {
        throw new AppError('Vendor profile not found.', 403);
      }
      rfq = await RfqRepository.getByIdForVendor(rfqId, vendorId);
    }

    if (!rfq) {
      throw new AppError('RFQ not found.', 404);
    }

    const offers = await RfqRepository.getOffersForRfq(rfqId);
    return {
      ...rfq,
      offers: offers.map((offer) => ({
        ...offer,
        vendor: {
          id: offer.vendor_id,
          user_id: offer.vendor_user_id,
          company_name: offer.vendor_company_name,
          logo_url: offer.vendor_logo_url,
          is_verified: `${offer.vendor_verification_status || ''}`.toUpperCase() === 'APPROVED'
        }
      }))
    };
  }

  async deleteRfq(rfqId, userId) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.getDeleteCandidateForUser(rfqId, userId, connection);
      if (!rfq) {
        throw new AppError('RFQ not found.', 404);
      }
      const matchingVendors = await RfqRepository.getMatchingVendors(rfq.category_id, connection);
      const vendorUserIds = matchingVendors.map((vendor) => vendor.user_id).filter(Boolean);

      const blockedStatuses = [
        RFQ_STATUSES.ACCEPTED,
        RFQ_STATUSES.COMPLETED
      ];

      if (blockedStatuses.includes(rfq.status)) {
        throw new AppError('This RFQ can no longer be deleted.', 400);
      }

      if (Number(rfq.offers_count || 0) > 0) {
        throw new AppError('RFQ cannot be deleted after receiving offers.', 400);
      }

      if (Number(rfq.conversations_count || 0) > 0) {
        throw new AppError('RFQ cannot be deleted after starting conversations.', 400);
      }

      const deleted = await RfqRepository.deleteForUser(rfqId, userId, connection);
      if (!deleted) {
        throw new AppError('RFQ deletion failed.', 400);
      }

      await connection.commit();
      DashboardMetricsService.invalidateAdminDashboard();
      await Promise.allSettled([
        this._emitRfqEventToUsers(vendorUserIds, 'rfq.updated', {
          rfqId,
          status: 'DELETED'
        }),
        this._emitRfqDashboardRefresh({
          vendorUserIds,
          ownerUserId: userId,
          admin: true,
          payload: {
            rfqId,
            status: 'DELETED'
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId,
          status: 'DELETED',
          revision: Date.now()
        })
      ]);
      return { rfqId, deleted: true };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async completeRfq(rfqId, userId) {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const rfq = await RfqRepository.getByIdForUser(rfqId, userId, connection);
      if (!rfq) {
        throw new AppError('RFQ not found.', 404);
      }

      if (rfq.status === RFQ_STATUSES.COMPLETED) {
        throw new AppError('This RFQ is already completed.', 400);
      }

      const terminalStatuses = [RFQ_STATUSES.CANCELED, RFQ_STATUSES.EXPIRED, RFQ_STATUSES.REJECTED];
      if (terminalStatuses.includes(rfq.status)) {
        throw new AppError('This RFQ cannot be marked as completed.', 400);
      }

      validateTransition(rfq.status, RFQ_STATUSES.COMPLETED);

      const matchingVendors = await RfqRepository.getMatchingVendors(rfq.category_id, connection);
      const vendorUserIds = matchingVendors.map((vendor) => vendor.user_id).filter(Boolean);

      await RfqRepository.updateStatus(
        rfqId,
        rfq.status,
        RFQ_STATUSES.COMPLETED,
        userId,
        'Buyer marked the RFQ as completed',
        connection
      );

      await connection.commit();
      DashboardMetricsService.invalidateAdminDashboard();

      await Promise.allSettled([
        this._emitRfqEventToUsers(vendorUserIds, 'rfq.updated', {
          rfqId,
          status: RFQ_STATUSES.COMPLETED
        }),
        this._emitRfqDashboardRefresh({
          vendorUserIds,
          ownerUserId: userId,
          admin: true,
          payload: {
            rfqId,
            status: RFQ_STATUSES.COMPLETED
          }
        }),
        RealtimeService.emitToRole('admin', 'rfq.updated', {
          rfqId,
          status: RFQ_STATUSES.COMPLETED,
          revision: Date.now()
        })
      ]);

      return {
        rfqId,
        status: RFQ_STATUSES.COMPLETED
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Cron/Scheduled routine to detect expired RFQs and natively mark them.
   */
  async expireOldLeads() {
    await RfqRepository.initializeRuntimeSchema(pool);
    const connection = await pool.getConnection();
    try {
      // Find leads whose expiration_time has passed and are not in terminal states.
      const [expiredRows] = await connection.execute(
        `SELECT id, status FROM rfq_requests 
         WHERE expiration_time < NOW() 
         AND status NOT IN ('EXPIRED', 'CANCELED', 'COMPLETED', 'DRAFT')`
      );

      if (expiredRows.length === 0) return 0;

      for (const row of expiredRows) {
        // Technically validate transition, but we can fast-track to EXPIRED
        await connection.execute(`UPDATE rfq_requests SET status = 'EXPIRED' WHERE id = ?`, [row.id]);
        await connection.execute(
           `INSERT INTO rfq_status_history (rfq_id, old_status, new_status, changed_by, notes)
            VALUES (?, ?, 'EXPIRED', 0, 'System Auto-Expirator')`,
           [row.id, row.status] // changed_by = 0 denotes SYSTEM
        );
      }
      return expiredRows.length;
    } finally {
      connection.release();
    }
  }
}

export default new RfqService();
