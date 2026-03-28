/**
 * @file index.js
 * @description Central API Routing Hub.
 * Aggregates all domain-specific routers and mounts them under the /api/v1 namespace.
 * Defines the public-facing entry points for the platform.
 */

import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import productRoutes from './productRoutes.js';
import chatRoutes from './chatRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import siteSettingsRoutes from './siteSettingsRoutes.js';
import cartRoutes from './cartRoutes.js';
import orderRoutes from './orderRoutes.js';
import quoteRoutes from './quoteRoutes.js';
import rfqRoutes from './rfqRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import vendorRoutes from './vendorRoutes.js';
import adminRoutes from './adminRoutes.js';
import ownerRoutes from './ownerRoutes.js';
import contactRoutes from './contactRoutes.js';
import quickReplyRoutes from './quickReplyRoutes.js';
import realtimeRoutes from './realtimeRoutes.js';

const router = express.Router();

/**
 * Domain Mount Points:
 * Each module handles its own internal routing logic and role-based guards.
 */

// Identity & Account Management
router.use('/auth', authRoutes);         // Public: registration & login
router.use('/user', userRoutes);         // Authenticated: personal profiles
router.use('/owner', ownerRoutes);       // Owner-Only: master overrides

// Catalog & Inventory
router.use('/categories', categoryRoutes); // Mixed: visualization & management
router.use('/products', productRoutes);     // Mixed: discovery & merchant catalog
router.use('/vendors', vendorRoutes);       // Mixed: directories & verification
router.use('/vendor', vendorRoutes);        // Singular mount for dashboard compatibility

// Commerce & Transactional Flows
router.use('/cart', cartRoutes);             // Authenticated: ephemeral state
router.use('/orders', orderRoutes);           // Mixed: checkout, escrow, & tracking
router.use('/quotes', quoteRoutes);           // Mixed: RFQ & price negotiation
router.use('/rfq', rfqRoutes);               // Mixed: Category-wide RFQs
router.use('/reviews', reviewRoutes);         // Mixed: feedback & reputation

// Communication & Engagement
router.use('/chats', chatRoutes);               // Authenticated: B2B inquiries
router.use('/notifications', notificationRoutes); // Authenticated: user alerts

// Administration & Configuration
router.use('/admin', adminRoutes);            // Admin-Only: user management & stats
router.use('/settings', siteSettingsRoutes);   // Admin-Only: global site config
router.use('/contact', contactRoutes);         // Mixed: Public submit, Admin view
router.use('/quick-replies', quickReplyRoutes); // Mixed: Vendor/Admin templates
router.use('/realtime', realtimeRoutes);        // Authenticated: Pusher auth + client realtime actions

export default router;
