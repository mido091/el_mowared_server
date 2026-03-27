import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const DEFAULT_MESSAGES = {
  BAD_REQUEST: {
    en: 'The request could not be completed.',
    ar: 'تعذر إكمال الطلب.'
  },
  UNAUTHORIZED: {
    en: 'You need to sign in to continue.',
    ar: 'تحتاج إلى تسجيل الدخول للمتابعة.'
  },
  FORBIDDEN: {
    en: 'You are not allowed to perform this action.',
    ar: 'غير مسموح لك بتنفيذ هذا الإجراء.'
  },
  NOT_FOUND: {
    en: 'The requested resource was not found.',
    ar: 'العنصر المطلوب غير موجود.'
  },
  VALIDATION_ERROR: {
    en: 'Please review the highlighted fields and try again.',
    ar: 'يرجى مراجعة الحقول المحددة ثم المحاولة مرة أخرى.'
  },
  RATE_LIMITED: {
    en: 'Too many requests. Please try again shortly.',
    ar: 'هناك عدد كبير من الطلبات. يرجى المحاولة بعد قليل.'
  },
  SERVER_ERROR: {
    en: 'Something went wrong, please try again.',
    ar: 'حدث خطأ، حاول مرة أخرى.'
  },
  CORS_BLOCKED: {
    en: 'This request is not allowed from the current origin.',
    ar: 'هذا الطلب غير مسموح به من المصدر الحالي.'
  },
  INVALID_FILE_TYPE: {
    en: 'Invalid file type. Only image files are allowed.',
    ar: 'نوع الملف غير صحيح. يُسمح فقط برفع الصور.'
  },
  FILE_TOO_LARGE: {
    en: 'The uploaded file is too large.',
    ar: 'الملف المرفوع أكبر من الحجم المسموح.'
  }
};

const FIELD_LABELS = {
  email: { en: 'Email address', ar: 'البريد الإلكتروني' },
  password: { en: 'Password', ar: 'كلمة المرور' },
  newPassword: { en: 'New password', ar: 'كلمة المرور الجديدة' },
  resetToken: { en: 'Reset token', ar: 'رمز إعادة التعيين' },
  otp: { en: 'Verification code', ar: 'رمز التحقق' },
  first_name: { en: 'First name', ar: 'الاسم الأول' },
  last_name: { en: 'Last name', ar: 'اسم العائلة' },
  full_name: { en: 'Full name', ar: 'الاسم الكامل' },
  company_name: { en: 'Company name', ar: 'اسم الشركة' },
  companyNameAr: { en: 'Company name in Arabic', ar: 'اسم الشركة بالعربية' },
  companyNameEn: { en: 'Company name in English', ar: 'اسم الشركة بالإنجليزية' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  address: { en: 'Address', ar: 'العنوان' },
  bio: { en: 'Company bio', ar: 'نبذة الشركة' },
  category: { en: 'Category', ar: 'الفئة' },
  category_id: { en: 'Category', ar: 'الفئة' },
  categoryId: { en: 'Category', ar: 'الفئة' },
  categoryIds: { en: 'Categories', ar: 'الفئات' },
  productId: { en: 'Product', ar: 'المنتج' },
  product_id: { en: 'Product', ar: 'المنتج' },
  vendorId: { en: 'Vendor', ar: 'المورد' },
  buyerId: { en: 'Buyer', ar: 'المشتري' },
  title: { en: 'Title', ar: 'العنوان' },
  description: { en: 'Description', ar: 'الوصف' },
  description_ar: { en: 'Arabic description', ar: 'الوصف بالعربية' },
  description_en: { en: 'English description', ar: 'الوصف بالإنجليزية' },
  name: { en: 'Name', ar: 'الاسم' },
  name_ar: { en: 'Arabic product name', ar: 'اسم المنتج بالعربية' },
  name_en: { en: 'English product name', ar: 'اسم المنتج بالإنجليزية' },
  quantity: { en: 'Quantity', ar: 'الكمية' },
  quantity_available: { en: 'Available quantity', ar: 'الكمية المتاحة' },
  quantityAvailable: { en: 'Available quantity', ar: 'الكمية المتاحة' },
  min_order_quantity: { en: 'Minimum order quantity', ar: 'الحد الأدنى للطلب' },
  minOrderQuantity: { en: 'Minimum order quantity', ar: 'الحد الأدنى للطلب' },
  target_price: { en: 'Target price', ar: 'السعر المستهدف' },
  offered_price: { en: 'Offer price', ar: 'سعر العرض' },
  price: { en: 'Price', ar: 'السعر' },
  discountPrice: { en: 'Discount price', ar: 'سعر الخصم' },
  delivery_time: { en: 'Delivery time', ar: 'مدة التوريد' },
  message: { en: 'Message', ar: 'الرسالة' },
  notes: { en: 'Notes', ar: 'الملاحظات' },
  reason: { en: 'Reason', ar: 'السبب' },
  rejection_reason: { en: 'Rejection reason', ar: 'سبب الرفض' },
  status: { en: 'Status', ar: 'الحالة' },
  action: { en: 'Action', ar: 'الإجراء' },
  expiration_time: { en: 'Expiration date', ar: 'تاريخ الانتهاء' },
  max_responders: { en: 'Maximum responders', ar: 'الحد الأقصى للموردين' },
  paymentMethod: { en: 'Payment method', ar: 'طريقة الدفع' },
  depositAmount: { en: 'Deposit amount', ar: 'قيمة العربون' }
};

const LEGACY_MESSAGE_MAP = {
  'You cannot change your own role': {
    en: 'You cannot change your own role from this screen.',
    ar: 'لا يمكنك تغيير دورك من هذه الشاشة.'
  },
  'User not found': {
    en: 'The requested user was not found.',
    ar: 'المستخدم المطلوب غير موجود.'
  },
  'You cannot change your own status': {
    en: 'You cannot change your own account status.',
    ar: 'لا يمكنك تغيير حالة حسابك بنفسك.'
  },
  'You cannot delete your own account from here': {
    en: 'You cannot delete your own account from this screen.',
    ar: 'لا يمكنك حذف حسابك من هذه الشاشة.'
  },
  'No image provided': {
    en: 'Please choose an image to continue.',
    ar: 'يرجى اختيار صورة للمتابعة.'
  },
  'Unsupported review type.': {
    en: 'This review type is not supported.',
    ar: 'نوع التقييم هذا غير مدعوم.'
  },
  'Cart is empty': {
    en: 'Your cart is empty.',
    ar: 'سلة المشتريات فارغة.'
  },
  'Category not found': {
    en: 'The selected category was not found.',
    ar: 'الفئة المحددة غير موجودة.'
  },
  'Conversation not found or access denied': {
    en: 'This conversation was not found or you do not have access to it.',
    ar: 'هذه المحادثة غير موجودة أو ليس لديك صلاحية للوصول إليها.'
  },
  'Please wait for the support agent to reply before sending another message.': {
    en: 'Please wait for the support agent to reply before sending another message.',
    ar: 'يرجى انتظار رد موظف الدعم قبل إرسال رسالة أخرى.'
  },
  'Authentication context missing': {
    en: 'Your session is incomplete. Please sign in again.',
    ar: 'جلسة المستخدم غير مكتملة. يرجى تسجيل الدخول مرة أخرى.'
  },
  'No files uploaded': {
    en: 'Please choose at least one file to upload.',
    ar: 'يرجى اختيار ملف واحد على الأقل للرفع.'
  },
  'Only admin or owner can permanently delete support conversations.': {
    en: 'Only admins can permanently delete support conversations.',
    ar: 'فقط الإدارة يمكنها حذف محادثات الدعم نهائيًا.'
  },
  'Order not found or unauthorized': {
    en: 'This order was not found or you do not have access to it.',
    ar: 'هذا الطلب غير موجود أو لا تملك صلاحية الوصول إليه.'
  },
  'Email already in use': {
    en: 'This email is already in use.',
    ar: 'هذا البريد الإلكتروني مستخدم بالفعل.'
  },
  'You cannot deactivate your own account': {
    en: 'You cannot deactivate your own account.',
    ar: 'لا يمكنك تعطيل حسابك بنفسك.'
  },
  'Cannot demote the last remaining OWNER': {
    en: 'The last remaining owner cannot be demoted.',
    ar: 'لا يمكن خفض صلاحية آخر مالك متبقٍ.'
  },
  'Invalid key for media upload': {
    en: 'The selected media field is not valid.',
    ar: 'حقل الوسائط المحدد غير صالح.'
  },
  'Vendor profile not found': {
    en: 'Vendor profile not found.',
    ar: 'ملف المورد غير موجود.'
  },
  'Unauthorized': DEFAULT_MESSAGES.FORBIDDEN,
  'Report not found': {
    en: 'The requested report was not found.',
    ar: 'التقرير المطلوب غير موجود.'
  },
  'Email already in use or account pending approval': {
    en: 'This email is already in use or waiting for approval.',
    ar: 'هذا البريد الإلكتروني مستخدم بالفعل أو ما زال بانتظار الموافقة.'
  },
  'Registration session expired. Please register again.': {
    en: 'Your registration session expired. Please register again.',
    ar: 'انتهت صلاحية جلسة التسجيل. يرجى التسجيل مرة أخرى.'
  },
  'Registration session is invalid. Please register again.': {
    en: 'This registration session is invalid. Please register again.',
    ar: 'جلسة التسجيل هذه غير صالحة. يرجى التسجيل مرة أخرى.'
  },
  'Invalid email or password': {
    en: 'Invalid email or password.',
    ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  },
  'Your account is pending approval. Please wait 24 hours.': {
    en: 'Your account is pending approval. Please wait for review.',
    ar: 'حسابك ما زال بانتظار الموافقة. يرجى انتظار المراجعة.'
  },
  'Your account application was rejected. You may register again with new details.': {
    en: 'Your account application was rejected. You can register again with updated details.',
    ar: 'تم رفض طلب الحساب. يمكنك التسجيل مرة أخرى ببيانات محدثة.'
  },
  'Please verify your email address before logging in.': {
    en: 'Please verify your email address before signing in.',
    ar: 'يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.'
  },
  'No account found with this email': {
    en: 'No account was found with this email address.',
    ar: 'لا يوجد حساب مرتبط بهذا البريد الإلكتروني.'
  },
  'Reset link has expired or is invalid. Please start over.': {
    en: 'The reset link is invalid or has expired. Please start again.',
    ar: 'رابط إعادة التعيين غير صالح أو انتهت صلاحيته. يرجى البدء من جديد.'
  },
  'Invalid reset token': {
    en: 'The reset token is invalid.',
    ar: 'رمز إعادة التعيين غير صالح.'
  },
  'Current password is incorrect': {
    en: 'The current password is incorrect.',
    ar: 'كلمة المرور الحالية غير صحيحة.'
  },
  'Product not found': {
    en: 'The requested product was not found.',
    ar: 'المنتج المطلوب غير موجود.'
  },
  'Product not found.': {
    en: 'The requested product was not found.',
    ar: 'المنتج المطلوب غير موجود.'
  },
  'RFQ buyer could not be resolved for this conversation.': {
    en: 'The RFQ owner could not be identified for this conversation.',
    ar: 'تعذر تحديد صاحب طلب العرض لهذه المحادثة.'
  },
  'Only admin or owner can claim support conversations.': {
    en: 'Only admins can claim support conversations.',
    ar: 'فقط الإدارة يمكنها استلام محادثات الدعم.'
  },
  'Support conversation not found.': {
    en: 'Support conversation not found.',
    ar: 'محادثة الدعم غير موجودة.'
  },
  'This support conversation is no longer active.': {
    en: 'This support conversation is no longer active.',
    ar: 'محادثة الدعم هذه لم تعد نشطة.'
  },
  'This support conversation has already been claimed.': {
    en: 'This support conversation has already been claimed.',
    ar: 'تم استلام محادثة الدعم هذه بالفعل.'
  },
  'Conversation not found.': {
    en: 'Conversation not found.',
    ar: 'المحادثة غير موجودة.'
  },
  'Order not found': {
    en: 'The requested order was not found.',
    ar: 'الطلب المطلوب غير موجود.'
  },
  'Unauthorized to update this order': {
    en: 'You are not allowed to update this order.',
    ar: 'غير مسموح لك بتحديث هذا الطلب.'
  },
  'Verification code has expired or is invalid. Please request a new one.': {
    en: 'The verification code is invalid or has expired. Please request a new one.',
    ar: 'رمز التحقق غير صالح أو انتهت صلاحيته. يرجى طلب رمز جديد.'
  },
  'Too many failed attempts. Code invalidated. Please request a new one.': {
    en: 'Too many failed attempts. Please request a new code.',
    ar: 'تم تجاوز عدد المحاولات المسموح. يرجى طلب رمز جديد.'
  },
  'Incorrect verification code. Please try again.': {
    en: 'The verification code is incorrect. Please try again.',
    ar: 'رمز التحقق غير صحيح. يرجى المحاولة مرة أخرى.'
  },
  'Quantity available must be a non-negative integer.': {
    en: 'Available quantity must be zero or greater.',
    ar: 'يجب أن تكون الكمية المتاحة صفرًا أو أكثر.'
  },
  'Product not found or unauthorized': {
    en: 'This product was not found or you do not have access to it.',
    ar: 'هذا المنتج غير موجود أو لا تملك صلاحية الوصول إليه.'
  },
  'Invalid review action. Must be APPROVE or REJECT.': {
    en: 'Invalid review action. Please choose approve or reject.',
    ar: 'إجراء المراجعة غير صالح. يرجى اختيار قبول أو رفض.'
  },
  'You can review this supplier only after a real interaction.': {
    en: 'You can review this supplier only after a real interaction.',
    ar: 'يمكنك تقييم هذا المورد فقط بعد تفاعل فعلي.'
  },
  'You can review this product only after a real interaction.': {
    en: 'You can review this product only after a real interaction.',
    ar: 'يمكنك تقييم هذا المنتج فقط بعد تفاعل فعلي.'
  },
  'You already submitted a review for this item. Edit it instead.': {
    en: 'You already submitted a review for this item. Please edit the existing review instead.',
    ar: 'لقد أرسلت تقييمًا لهذا العنصر بالفعل. يرجى تعديل التقييم الحالي بدلاً من إضافة واحد جديد.'
  },
  'Review not found for this target.': {
    en: 'No review was found for this item.',
    ar: 'لم يتم العثور على تقييم لهذا العنصر.'
  },
  'Review not found.': {
    en: 'The requested review was not found.',
    ar: 'التقييم المطلوب غير موجود.'
  },
  'RFQ not found': {
    en: 'The requested RFQ was not found.',
    ar: 'طلب العرض المطلوب غير موجود.'
  },
  'RFQ is already rejected.': {
    en: 'This RFQ has already been rejected.',
    ar: 'تم رفض طلب العرض هذا بالفعل.'
  },
  'This RFQ has expired.': {
    en: 'This RFQ has expired.',
    ar: 'انتهت صلاحية طلب العرض هذا.'
  },
  'Max response limit reached for this RFQ.': {
    en: 'This RFQ has reached the maximum number of supplier responses.',
    ar: 'وصل طلب العرض هذا إلى الحد الأقصى من ردود الموردين.'
  },
  'RFQ not found or not accessible.': {
    en: 'This RFQ was not found or you do not have access to it.',
    ar: 'طلب العرض هذا غير موجود أو لا تملك صلاحية الوصول إليه.'
  },
  'This RFQ can no longer be declined.': {
    en: 'This RFQ can no longer be declined.',
    ar: 'لا يمكن رفض طلب العرض هذا الآن.'
  },
  'You already submitted an offer for this RFQ.': {
    en: 'You already submitted an offer for this RFQ.',
    ar: 'لقد قدمت عرضًا لهذا الطلب بالفعل.'
  },
  'You already started a conversation for this RFQ.': {
    en: 'You already started a conversation for this RFQ.',
    ar: 'لقد بدأت محادثة لهذا الطلب بالفعل.'
  },
  'Offer not found': {
    en: 'The requested offer was not found.',
    ar: 'العرض المطلوب غير موجود.'
  },
  'Unauthorized: Only the requester can accept offers.': {
    en: 'Only the RFQ owner can accept offers.',
    ar: 'فقط صاحب طلب العرض يمكنه قبول العروض.'
  },
  'Vendor profile not found.': {
    en: 'Vendor profile not found.',
    ar: 'ملف المورد غير موجود.'
  },
  'RFQ not found.': {
    en: 'The requested RFQ was not found.',
    ar: 'طلب العرض المطلوب غير موجود.'
  },
  'This RFQ can no longer be deleted.': {
    en: 'This RFQ can no longer be deleted.',
    ar: 'لا يمكن حذف طلب العرض هذا الآن.'
  },
  'RFQ cannot be deleted after receiving offers.': {
    en: 'This RFQ cannot be deleted after receiving offers.',
    ar: 'لا يمكن حذف طلب العرض بعد استلام عروض عليه.'
  },
  'RFQ cannot be deleted after starting conversations.': {
    en: 'This RFQ cannot be deleted after starting conversations.',
    ar: 'لا يمكن حذف طلب العرض بعد بدء المحادثات.'
  },
  'RFQ deletion failed.': {
    en: 'Unable to delete this RFQ right now.',
    ar: 'تعذر حذف طلب العرض الآن.'
  },
  'A valid product is required.': {
    en: 'A valid product is required.',
    ar: 'يجب اختيار منتج صالح.'
  },
  'Quantity must be greater than zero.': {
    en: 'Quantity must be greater than zero.',
    ar: 'يجب أن تكون الكمية أكبر من صفر.'
  },
  'Gross sale amount must be zero or greater.': {
    en: 'Gross sale amount must be zero or greater.',
    ar: 'يجب أن يكون إجمالي مبلغ البيع صفرًا أو أكثر.'
  },
  'Net profit must be zero or greater.': {
    en: 'Net profit must be zero or greater.',
    ar: 'يجب أن يكون صافي الربح صفرًا أو أكثر.'
  },
  'A valid sale date is required.': {
    en: 'A valid sale date is required.',
    ar: 'يجب إدخال تاريخ بيع صالح.'
  },
  'Selected product was not found for this vendor.': {
    en: 'The selected product was not found for this vendor.',
    ar: 'المنتج المحدد غير موجود لهذا المورد.'
  },
  'Only active approved products can be used in sales review.': {
    en: 'Only active approved products can be used in sales review.',
    ar: 'يمكن استخدام المنتجات النشطة المعتمدة فقط في مراجعة المبيعات.'
  },
  'Insufficient stock for this sale quantity.': {
    en: 'There is not enough stock for this sale quantity.',
    ar: 'لا توجد كمية كافية في المخزون لهذه الكمية المباعة.'
  },
  'Sale record not found.': {
    en: 'Sale record not found.',
    ar: 'سجل البيع غير موجود.'
  },
  'Original product record was not found.': {
    en: 'The original product record was not found.',
    ar: 'سجل المنتج الأصلي غير موجود.'
  },
  'Product record was not found.': {
    en: 'The product record was not found.',
    ar: 'سجل المنتج غير موجود.'
  },
  'Vendor not found.': {
    en: 'Vendor not found.',
    ar: 'المورد غير موجود.'
  },
  'Vendor not found': {
    en: 'Vendor not found.',
    ar: 'المورد غير موجود.'
  },
  'Only JPEG, PNG, and WebP files are allowed.': DEFAULT_MESSAGES.INVALID_FILE_TYPE,
  'Invalid file MIME type.': DEFAULT_MESSAGES.INVALID_FILE_TYPE,
  'Uploaded file buffer is missing.': {
    en: 'The uploaded file could not be processed.',
    ar: 'تعذر معالجة الملف المرفوع.'
  },
  'Image exceeds the maximum allowed size of 2MB.': {
    en: 'The image is too large. Maximum size is 2MB.',
    ar: 'حجم الصورة كبير جدًا. الحد الأقصى 2 ميجابايت.'
  },
  'Invalid image extension.': DEFAULT_MESSAGES.INVALID_FILE_TYPE,
  'Uploaded file is not a valid image.': {
    en: 'The uploaded file is not a valid image.',
    ar: 'الملف المرفوع ليس صورة صالحة.'
  }
};

const startsWithAny = (value, candidates = []) =>
  candidates.some((candidate) => typeof value === 'string' && value.startsWith(candidate));

export const toLocalizedMessage = (message, fallback = DEFAULT_MESSAGES.SERVER_ERROR) => {
  if (message && typeof message === 'object' && typeof message.en === 'string' && typeof message.ar === 'string') {
    return message;
  }

  if (typeof message === 'string' && LEGACY_MESSAGE_MAP[message]) {
    return LEGACY_MESSAGE_MAP[message];
  }

  if (typeof message === 'string') {
    if (startsWithAny(message, ["Email '"])) {
      return {
        en: 'This email address is already in use.',
        ar: 'عنوان البريد الإلكتروني هذا مستخدم بالفعل.'
      };
    }

    if (startsWithAny(message, ['Cannot move from ', 'Invalid status transition from '])) {
      return {
        en: 'This status change is not allowed.',
        ar: 'تغيير الحالة هذا غير مسموح به.'
      };
    }

    if (startsWithAny(message, ['A data integrity error occurred during update:'])) {
      return {
        en: 'A data integrity error occurred while saving your changes.',
        ar: 'حدث خطأ في سلامة البيانات أثناء حفظ التعديلات.'
      };
    }

    return {
      en: message,
      ar: fallback.ar
    };
  }

  return fallback;
};

const toFieldLabel = (field) => FIELD_LABELS[field] || {
  en: String(field || 'Field').replace(/[_-]/g, ' '),
  ar: 'هذا الحقل'
};

const buildFieldMessage = (field, issueType = 'invalid', extra = {}) => {
  const label = toFieldLabel(field);

  if (issueType === 'required') {
    return {
      en: `${label.en} is required.`,
      ar: `${label.ar} مطلوب.`
    };
  }

  if (issueType === 'email') {
    return {
      en: 'Please enter a valid email address.',
      ar: 'يرجى إدخال بريد إلكتروني صحيح.'
    };
  }

  if (issueType === 'min') {
    if (extra.kind === 'number') {
      return {
        en: `${label.en} must be at least ${extra.value}.`,
        ar: `يجب ألا تقل قيمة ${label.ar} عن ${extra.value}.`
      };
    }
    return {
      en: `${label.en} is too short.`,
      ar: `${label.ar} قصير جدًا.`
    };
  }

  if (issueType === 'positive') {
    return {
      en: `${label.en} must be greater than zero.`,
      ar: `يجب أن تكون قيمة ${label.ar} أكبر من صفر.`
    };
  }

  if (issueType === 'nonnegative') {
    return {
      en: `${label.en} cannot be less than zero.`,
      ar: `لا يمكن أن تكون قيمة ${label.ar} أقل من صفر.`
    };
  }

  if (issueType === 'enum') {
    return {
      en: `${label.en} contains an invalid value.`,
      ar: `${label.ar} يحتوي على قيمة غير صالحة.`
    };
  }

  return {
    en: `${label.en} is invalid.`,
    ar: `${label.ar} غير صالح.`
  };
};

const issueTypeFromZod = (issue) => {
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return 'required';
  if (issue.code === 'too_small' && issue.type === 'string' && issue.minimum === 1) return 'required';
  if (issue.code === 'invalid_string' && issue.validation === 'email') return 'email';
  if (issue.code === 'too_small') return 'min';
  if (issue.code === 'invalid_enum_value') return 'enum';
  return 'invalid';
};

const toFieldKey = (path) => {
  if (Array.isArray(path) && path.length) return String(path[0]);
  if (typeof path === 'string') return path;
  return 'general';
};

const addFieldError = (fields, key, message) => {
  if (!fields[key]) {
    fields[key] = message;
  }
};

export const normalizeZodIssues = (issues = []) => {
  const fields = {};

  for (const issue of issues) {
    const key = toFieldKey(issue.path);
    const mappedMessage = LEGACY_MESSAGE_MAP[issue.message];
    const issueType = issueTypeFromZod(issue);

    addFieldError(
      fields,
      key,
      mappedMessage || buildFieldMessage(key, issueType, {
        kind: issue.type,
        value: issue.minimum
      })
    );
  }

  return fields;
};

export const normalizeJoiDetails = (details = []) => {
  const fields = {};

  for (const detail of details) {
    const key = toFieldKey(detail.path);
    const issueType =
      detail.type === 'any.required' ? 'required'
        : detail.type === 'string.email' ? 'email'
          : detail.type?.includes('min') ? 'min'
            : 'invalid';

    addFieldError(fields, key, buildFieldMessage(key, issueType, {
      kind: detail.type?.startsWith('number') ? 'number' : 'string',
      value: detail.context?.limit
    }));
  }

  return fields;
};

export class AppError extends Error {
  constructor(message, status = 400, code = 'APP_ERROR', options = {}) {
    const localized = toLocalizedMessage(message, DEFAULT_MESSAGES.SERVER_ERROR);
    super(localized.en);
    this.name = 'AppError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.message = localized;
    this.fields = options.fields || null;
    this.details = options.details || null;
    this.isOperational = options.isOperational !== false;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export const badRequest = (message, code = 'BAD_REQUEST', options = {}) =>
  new AppError(message || DEFAULT_MESSAGES.BAD_REQUEST, 400, code, options);

export const unauthorized = (message, code = 'UNAUTHORIZED', options = {}) =>
  new AppError(message || DEFAULT_MESSAGES.UNAUTHORIZED, 401, code, options);

export const forbidden = (message, code = 'FORBIDDEN', options = {}) =>
  new AppError(message || DEFAULT_MESSAGES.FORBIDDEN, 403, code, options);

export const notFound = (message, code = 'NOT_FOUND', options = {}) =>
  new AppError(message || DEFAULT_MESSAGES.NOT_FOUND, 404, code, options);

export const validationError = (message = DEFAULT_MESSAGES.VALIDATION_ERROR, fields = {}, options = {}) =>
  new AppError(message, 400, 'VALIDATION_ERROR', { ...options, fields });

const normalizeDatabaseError = (error) => {
  if (error.code === 'ER_DUP_ENTRY') {
    return badRequest({
      en: 'This record already exists.',
      ar: 'هذا السجل موجود بالفعل.'
    }, 'DUPLICATE_ENTRY');
  }

  if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) {
    return badRequest({
      en: 'This action cannot be completed because related data still exists.',
      ar: 'لا يمكن إكمال هذا الإجراء لوجود بيانات مرتبطة به.'
    }, 'RELATED_RESOURCE_CONFLICT');
  }

  if (error.code === 'ER_BAD_NULL_ERROR') {
    return validationError(DEFAULT_MESSAGES.VALIDATION_ERROR, {});
  }

  return new AppError(DEFAULT_MESSAGES.SERVER_ERROR, 500, 'DATABASE_ERROR');
};

const normalizeRateLimitError = () =>
  new AppError(DEFAULT_MESSAGES.RATE_LIMITED, 429, 'RATE_LIMITED');

const normalizeUnknownError = (error) => {
  if (error instanceof AppError) return error;

  if (error instanceof z.ZodError || error?.name === 'ZodError') {
    return validationError(DEFAULT_MESSAGES.VALIDATION_ERROR, normalizeZodIssues(error.issues || error.errors || []));
  }

  if (error?.isJoi && Array.isArray(error.details)) {
    return validationError(DEFAULT_MESSAGES.VALIDATION_ERROR, normalizeJoiDetails(error.details));
  }

  if (error?.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return badRequest({
        en: 'The image is too large. Maximum size is 2MB.',
        ar: 'حجم الصورة كبير جدًا. الحد الأقصى 2 ميجابايت.'
      }, 'FILE_TOO_LARGE');
    }

    return badRequest(DEFAULT_MESSAGES.INVALID_FILE_TYPE, 'UPLOAD_ERROR');
  }

  if (error?.message === 'CORS blocked for this origin') {
    return forbidden(DEFAULT_MESSAGES.CORS_BLOCKED, 'CORS_BLOCKED');
  }

  if (error?.status === 429 || error?.code === 'RATE_LIMIT_EXCEEDED' || error?.code === 'ERR_ERL_REACHED') {
    return normalizeRateLimitError();
  }

  if (typeof error?.code === 'string' && (error.code.startsWith('ER_') || error.code === 'PROTOCOL_CONNECTION_LOST')) {
    return normalizeDatabaseError(error);
  }

  return new AppError(DEFAULT_MESSAGES.SERVER_ERROR, Number(error?.statusCode || error?.status || 500), error?.code || 'SERVER_ERROR', {
    isOperational: false,
    details: error?.details
  });
};

export const createErrorPayload = (error, req) => ({
  success: false,
  status: error.statusCode || error.status || 500,
  code: error.code || 'SERVER_ERROR',
  message: toLocalizedMessage(error.message, DEFAULT_MESSAGES.SERVER_ERROR),
  ...(error.fields && Object.keys(error.fields).length ? { fields: error.fields } : {}),
  ...(req?.requestId ? { requestId: req.requestId } : {})
});

export const requestIdMiddleware = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

export const errorHandler = (err, req, res, next) => {
  const normalized = normalizeUnknownError(err);
  const payload = createErrorPayload(normalized, req);

  logger.error('Global error handler', {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    status: payload.status,
    code: payload.code,
    error: {
      name: err?.name,
      message: err?.sqlMessage || err?.message,
      stack: err?.stack,
      fields: normalized.fields,
      details: normalized.details
    }
  });

  res.status(payload.status).json(payload);
};
