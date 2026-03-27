import { Joi } from '../middlewares/validate.js';

const idParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

const conversationIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

const reviewParams = Joi.object({
  productId: Joi.number().integer().positive(),
  vendorId: Joi.number().integer().positive(),
  type: Joi.string().valid('PRODUCT', 'VENDOR').optional(),
  offerId: Joi.number().integer().positive().optional(),
  id: Joi.number().integer().positive().optional()
});

export const authSchemas = {
  login: Joi.object({
    email: Joi.string().email().max(255).required(),
    password: Joi.string().min(6).max(128).required()
  }),
  resendOtp: Joi.object({
    email: Joi.string().email().max(255).required(),
    type: Joi.string().valid('REGISTRATION', 'PASSWORD_RESET').required()
  }),
  verifyOtp: Joi.object({
    email: Joi.string().email().max(255).required(),
    otp: Joi.string().length(6).pattern(/^\d+$/).required()
  }),
  forgotPassword: Joi.object({
    email: Joi.string().email().max(255).required()
  }),
  resetPassword: Joi.object({
    resetToken: Joi.string().min(10).max(2048).required(),
    newPassword: Joi.string().min(8).max(128).required()
  }),
  changePassword: Joi.object({
    currentPassword: Joi.string().min(6).max(128).required(),
    newPassword: Joi.string().min(8).max(128).required()
  }),
  cancelRegistration: Joi.object({
    email: Joi.string().email().max(255).required()
  })
};

export const productSchemas = {
  idParam,
  vendorIdParam: Joi.object({
    vendorId: Joi.number().integer().positive().required()
  }),
  compareQuery: Joi.object({
    ids: Joi.string().pattern(/^\d+(,\d+)*$/).required()
  }),
  metricsParam: idParam,
  create: Joi.object({
    categoryId: Joi.number().integer().positive(),
    category_id: Joi.number().integer().positive(),
    name_ar: Joi.string().min(3).max(255).required(),
    name_en: Joi.string().min(3).max(255).required(),
    description_ar: Joi.string().min(10).max(5000).required(),
    description_en: Joi.string().min(10).max(5000).required(),
    price: Joi.number().min(0),
    discountPrice: Joi.number().min(0),
    minOrderQuantity: Joi.number().integer().positive(),
    quantityAvailable: Joi.number().integer().min(0),
    quantity_available: Joi.number().integer().min(0),
    location: Joi.string().max(255).allow('', null),
    specs: Joi.alternatives().try(Joi.string(), Joi.array(), Joi.object())
  }).or('categoryId', 'category_id'),
  update: Joi.object({
    categoryId: Joi.number().integer().positive(),
    category_id: Joi.number().integer().positive(),
    name_ar: Joi.string().min(3).max(255),
    name_en: Joi.string().min(3).max(255),
    description_ar: Joi.string().min(10).max(5000),
    description_en: Joi.string().min(10).max(5000),
    price: Joi.number().min(0),
    discountPrice: Joi.number().min(0),
    minOrderQuantity: Joi.number().integer().positive(),
    quantityAvailable: Joi.number().integer().min(0),
    quantity_available: Joi.number().integer().min(0),
    location: Joi.string().max(255).allow('', null),
    specs: Joi.alternatives().try(Joi.string(), Joi.array(), Joi.object())
  }).min(1),
  bulkDelete: Joi.object({
    ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
  })
};

export const chatSchemas = {
  conversationIdParam,
  start: Joi.object({
    vendorId: Joi.number().integer().positive().allow(null),
    buyerId: Joi.number().integer().positive().allow(null),
    type: Joi.string().valid('INQUIRY', 'SUPPORT', 'PRODUCT', 'RFQ', 'ADMIN_VENDOR', 'INTERNAL'),
    productId: Joi.number().integer().positive().allow(null),
    relatedRfqId: Joi.number().integer().positive().allow(null),
    relatedOrderId: Joi.number().integer().positive().allow(null),
    requestedQuantity: Joi.number().positive().allow(null),
    messageText: Joi.string().trim().min(1).max(4000).required(),
    metadata: Joi.object().unknown(true),
    source: Joi.string().max(100).allow('', null)
  }),
  sendMessage: Joi.object({
    message: Joi.string().trim().min(1).max(4000).required(),
    metadata: Joi.object().unknown(true).allow(null)
  }),
  updateStatus: Joi.object({
    status: Joi.string().valid('active', 'idle', 'resolved', 'closed', 'archived').required()
  })
};

export const rfqSchemas = {
  idParam,
  offerIdParam: Joi.object({
    offerId: Joi.number().integer().positive().required()
  }),
  create: Joi.object({
    category_id: Joi.number().integer().positive().required(),
    title: Joi.string().trim().min(3).max(255).required(),
    description: Joi.string().max(5000).allow('', null),
    quantity: Joi.number().integer().positive().required(),
    target_price: Joi.number().positive().allow(null),
    lead_priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH'),
    expiration_time: Joi.alternatives().try(Joi.date().iso(), Joi.string().max(32)).optional(),
    max_responders: Joi.number().integer().min(1).max(50).optional(),
    specs: Joi.alternatives().try(Joi.string(), Joi.object(), Joi.array()).optional(),
    image_url: Joi.string().uri().optional()
  }),
  submitOffer: Joi.object({
    offered_price: Joi.number().positive().required(),
    delivery_time: Joi.string().trim().min(1).max(255).required(),
    notes: Joi.string().max(5000).allow('', null)
  }),
  feedQuery: Joi.object({
    search: Joi.string().max(255).allow('', null),
    category: Joi.number().integer().positive().empty('').optional(),
    region: Joi.string().max(255).allow('', null).optional(),
    status: Joi.string().valid('open', 'all', 'closed').allow('', null).optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional()
  })
};

export const reviewSchemas = {
  productParams: Joi.object({ productId: Joi.number().integer().positive().required() }),
  vendorParams: Joi.object({ vendorId: Joi.number().integer().positive().required() }),
  adminParams: Joi.object({
    type: Joi.string().valid('PRODUCT', 'VENDOR').required(),
    id: Joi.number().integer().positive().required()
  }),
  write: Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().max(1200).allow('', null)
  }),
  adminQuery: Joi.object({
    type: Joi.string().valid('PRODUCT', 'VENDOR').optional(),
    status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED').optional(),
    minRating: Joi.number().integer().min(1).max(5).optional(),
    maxRating: Joi.number().integer().min(1).max(5).optional(),
    search: Joi.string().max(255).allow('', null),
    dateFrom: Joi.date().iso().optional(),
    dateTo: Joi.date().iso().optional(),
    flaggedOnly: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').optional()
  })
};

export const orderSchemas = {
  idParam,
  checkout: Joi.object({
    paymentMethod: Joi.string().valid('COD', 'WALLET', 'INSTAPAY').required(),
    depositAmount: Joi.number().min(0).optional(),
    marketerId: Joi.number().integer().positive().optional()
  }),
  dispute: Joi.object({
    reason: Joi.string().trim().min(10).max(2000).required()
  }),
  confirmPayment: Joi.object({
    status: Joi.string().valid('VERIFIED', 'REJECTED').required(),
    note: Joi.string().max(1000).allow('', null)
  }),
  updateStatus: Joi.object({
    status: Joi.string().valid('PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED').required()
  })
};

export const vendorSchemas = {
  idParam,
  verify: Joi.object({
    status: Joi.string().valid('APPROVED', 'REJECTED', 'PENDING').required()
  }),
  updateProfile: Joi.object({
    companyNameAr: Joi.string().min(2).max(255).required(),
    companyNameEn: Joi.string().min(2).max(255).required(),
    bioAr: Joi.string().max(5000).allow('', null),
    bioEn: Joi.string().max(5000).allow('', null),
    location: Joi.string().max(255).allow('', null),
    categoryIds: Joi.array().items(Joi.number().integer().positive()).min(1).required()
  })
};

export const uploadSchemas = {
  imageUpload: Joi.object().unknown(true)
};
