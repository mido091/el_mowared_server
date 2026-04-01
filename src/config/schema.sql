-- Elmowared canonical schema
-- Non-destructive reference schema for the B2B lead-generation marketplace.

CREATE DATABASE IF NOT EXISTS elmowared CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE elmowared;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20) DEFAULT '',
  password VARCHAR(255) NOT NULL,
  role ENUM('OWNER', 'ADMIN', 'MOWARED', 'USER', 'MARKETER') DEFAULT 'USER',
  profile_image_url VARCHAR(255) DEFAULT 'https://res.cloudinary.com/ddqlt5oqu/image/upload/v1764967019/default_pi1ur8.webp',
  profile_image_public_id VARCHAR(255) DEFAULT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_name_ar VARCHAR(255) NOT NULL,
  company_name_en VARCHAR(255) NOT NULL,
  bio_ar TEXT NULL,
  bio_en TEXT NULL,
  logo VARCHAR(255) NULL,
  logo_public_id VARCHAR(255) NULL,
  verification_docs_public_id VARCHAR(255) NULL,
  verification_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
  location VARCHAR(255) NULL,
  avg_rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
  review_count INT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_vendor_profiles_user_id (user_id),
  INDEX idx_vendor_profiles_verification_status (verification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_ar VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  icon VARCHAR(255) NULL,
  parent_id INT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_category_junction (
  vendor_id INT NOT NULL,
  category_id INT NOT NULL,
  PRIMARY KEY (vendor_id, category_id),
  CONSTRAINT fk_vendor_category_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_category_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  category_id INT NOT NULL,
  name_ar VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  model_number VARCHAR(120) NULL,
  description_ar TEXT NOT NULL,
  description_en TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  price DECIMAL(10,2) DEFAULT 0.00,
  discount_price DECIMAL(10,2) NULL,
  min_order_quantity INT DEFAULT 1,
  quantity_available INT NOT NULL DEFAULT 0,
  avg_rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
  review_count INT NOT NULL DEFAULT 0,
  location VARCHAR(255) NULL,
  specs JSON NULL,
  is_active BOOLEAN DEFAULT TRUE,
  lifecycle_status ENUM('PENDING', 'APPROVED', 'REJECTED', 'UPDATE_PENDING') DEFAULT 'PENDING',
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'UPDATE_PENDING') DEFAULT 'PENDING',
  is_visible BOOLEAN DEFAULT FALSE,
  rejection_reason TEXT NULL,
  last_reviewed_by INT NULL,
  last_reviewed_at DATETIME NULL,
  is_edited BOOLEAN DEFAULT FALSE,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_last_reviewed_by FOREIGN KEY (last_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_products_vendor (vendor_id),
  INDEX idx_products_category (category_id),
  INDEX idx_products_model_number (model_number),
  INDEX idx_products_lifecycle_status (lifecycle_status),
  INDEX idx_products_status (status),
  INDEX idx_products_is_visible (is_visible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  image_url VARCHAR(255) NOT NULL,
  public_id VARCHAR(255) NOT NULL,
  is_main BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_images_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_status_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  old_status VARCHAR(50) NULL,
  new_status VARCHAR(50) NOT NULL,
  changed_by INT NULL,
  note TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_status_logs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_status_logs_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_product_status_logs_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  type ENUM('REGISTRATION', 'PASSWORD_RESET') NOT NULL,
  expires_at DATETIME NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  failed_attempts INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_verification_codes_email_type (email, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pending_registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  registration_role ENUM('USER', 'MOWARED') NOT NULL,
  payload_json LONGTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pending_registrations_role (registration_role),
  INDEX idx_pending_registrations_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cart_user_product (user_id, product_id),
  CONSTRAINT fk_cart_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  vendor_id INT NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  deposit_amount DECIMAL(10,2) DEFAULT 0.00,
  deposit_percentage TINYINT DEFAULT 0,
  status ENUM('PENDING', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED') DEFAULT 'PENDING',
  admin_approval_status ENUM('PENDING', 'VERIFIED', 'REJECTED') DEFAULT 'PENDING',
  payment_method ENUM('COD', 'WALLET', 'INSTAPAY') NOT NULL,
  dispute_reason TEXT NULL,
  referred_by_marketer_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_marketer FOREIGN KEY (referred_by_marketer_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_user (user_id),
  INDEX idx_orders_vendor (vendor_id),
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  price_at_purchase DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  transaction_image VARCHAR(255) NULL,
  transaction_image_public_id VARCHAR(255) NULL,
  verification_status ENUM('PENDING', 'VERIFIED', 'REJECTED') DEFAULT 'PENDING',
  admin_status ENUM('PENDING', 'VERIFIED', 'REJECTED') DEFAULT 'PENDING',
  admin_note TEXT NULL,
  verified_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  vendor_id INT NOT NULL,
  order_id INT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  is_verified_review BOOLEAN NOT NULL DEFAULT TRUE,
  interaction_type ENUM('ORDER', 'RFQ', 'CHAT', 'QUOTE') NULL,
  interaction_reference_id INT NULL,
  profanity_flag BOOLEAN NOT NULL DEFAULT FALSE,
  profanity_score INT NOT NULL DEFAULT 0,
  flag_reason VARCHAR(255) NULL,
  moderated_by INT NULL,
  moderated_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_reviews_vendor_status (vendor_id, status),
  CONSTRAINT fk_vendor_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_reviews_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_vendor_reviews_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  order_id INT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  is_verified_review BOOLEAN NOT NULL DEFAULT FALSE,
  interaction_type ENUM('ORDER', 'RFQ', 'CHAT', 'QUOTE') NULL,
  interaction_reference_id INT NULL,
  profanity_flag BOOLEAN NOT NULL DEFAULT FALSE,
  profanity_score INT NOT NULL DEFAULT 0,
  flag_reason VARCHAR(255) NULL,
  moderated_by INT NULL,
  moderated_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_product_reviews_target_user (product_id, user_id),
  INDEX idx_product_reviews_status (status),
  INDEX idx_product_reviews_product_status (product_id, status),
  CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_product_reviews_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  vendor_id INT NOT NULL,
  requested_quantity INT NOT NULL,
  target_price DECIMAL(10,2) NULL,
  notes TEXT NULL,
  status ENUM('PENDING', 'OFFERED', 'ACCEPTED', 'REJECTED') DEFAULT 'PENDING',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_quotation_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_requests_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_requests_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  rfq_items JSON NULL,
  quantity INT NOT NULL,
  target_price DECIMAL(10,2) NULL,
  privacy_type ENUM('PUBLIC', 'PRIVATE') DEFAULT 'PUBLIC',
  lead_priority ENUM('LOW', 'MEDIUM', 'HIGH') DEFAULT 'MEDIUM',
  lead_source VARCHAR(50) DEFAULT 'USER',
  expiration_time DATETIME NULL,
  max_responders INT DEFAULT 5,
  current_responders INT DEFAULT 0,
  specs JSON NULL,
  image_url VARCHAR(255) NULL,
  status ENUM('DRAFT', 'PENDING', 'APPROVED', 'BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELED', 'COMPLETED') DEFAULT 'DRAFT',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rfq_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_requests_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  INDEX idx_rfq_requests_user (user_id),
  INDEX idx_rfq_requests_category (category_id),
  INDEX idx_rfq_requests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rfq_id INT NOT NULL,
  vendor_id INT NOT NULL,
  offered_price DECIMAL(10,2) NOT NULL,
  delivery_time VARCHAR(100) NULL,
  notes TEXT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'REJECTED') DEFAULT 'PENDING',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rfq_offers_rfq FOREIGN KEY (rfq_id) REFERENCES rfq_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_offers_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rfq_id INT NOT NULL,
  old_status VARCHAR(50) NULL,
  new_status VARCHAR(50) NOT NULL,
  changed_by INT NOT NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rfq_status_history_rfq FOREIGN KEY (rfq_id) REFERENCES rfq_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_status_history_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_assignment_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rfq_id INT NOT NULL,
  vendor_id INT NOT NULL,
  action ENUM('VIEWED', 'RESPONDED', 'DECLINED') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rfq_assignment_logs_rfq FOREIGN KEY (rfq_id) REFERENCES rfq_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_assignment_logs_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_private_vendors (
  rfq_id INT NOT NULL,
  vendor_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rfq_id, vendor_id),
  CONSTRAINT fk_rfq_private_vendors_rfq FOREIGN KEY (rfq_id) REFERENCES rfq_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_rfq_private_vendors_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_scores (
  vendor_id INT PRIMARY KEY,
  response_speed_avg INT DEFAULT 0,
  response_rate DECIMAL(5,2) DEFAULT 0.00,
  conversion_rate DECIMAL(5,2) DEFAULT 0.00,
  completed_deals INT DEFAULT 0,
  badges JSON NULL,
  total_score DECIMAL(5,2) DEFAULT 0.00,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_scores_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  vendor_id INT NULL,
  admin_id INT NULL,
  status ENUM('waiting', 'assigned', 'active', 'idle', 'closed', 'archived') DEFAULT 'active',
  chat_status ENUM('ACTIVE', 'CLOSED', 'ARCHIVED') DEFAULT 'ACTIVE',
  type ENUM('INQUIRY', 'SUPPORT', 'INTERNAL') DEFAULT 'INQUIRY',
  product_id INT NULL,
  related_rfq_id INT NULL,
  related_order_id INT NULL,
  requested_quantity INT NULL,
  last_message TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_activity_at DATETIME NULL,
  closed_at DATETIME NULL,
  archived_at DATETIME NULL,
  expires_at DATETIME NULL,
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_rfq FOREIGN KEY (related_rfq_id) REFERENCES rfq_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_order FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL,
  INDEX idx_conversations_user (user_id),
  INDEX idx_conversations_vendor (vendor_id),
  INDEX idx_conversations_admin (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  message_text TEXT NULL,
  type ENUM('TEXT', 'INQUIRY', 'ATTACHMENT', 'SYSTEM', 'IMAGE', 'FILE') DEFAULT 'TEXT',
  attachments JSON NULL,
  product_snapshot JSON NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation (conversation_id),
  INDEX idx_messages_sender (sender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  data JSON NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key VARCHAR(191) PRIMARY KEY,
  setting_value LONGTEXT NULL,
  description TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(255) NOT NULL,
  target_id INT NULL,
  details TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_logs_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendor_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  order_id INT NULL,
  amount DECIMAL(10,2) NOT NULL,
  type ENUM('DEPOSIT', 'WITHDRAWAL', 'REFUND') NOT NULL,
  status ENUM('PENDING', 'COMPLETED', 'CANCELLED') DEFAULT 'PENDING',
  details TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendor_transactions_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_vendor_transactions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW vendor_stats AS
SELECT
  v.id AS vendor_id,
  v.user_id,
  v.company_name_ar,
  v.company_name_en,
  v.bio_ar,
  v.bio_en,
  v.location,
  v.verification_status,
  (v.verification_status = 'APPROVED') AS is_verified,
  COALESCE(v.avg_rating, 0) AS avg_rating,
  COALESCE(v.review_count, 0) AS review_count,
  IFNULL(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.total_price ELSE 0 END), 0) AS total_sales,
  COUNT(DISTINCT CASE WHEN o.status = 'COMPLETED' THEN o.id END) AS total_orders,
  IFNULL(vs.response_rate, 0) AS response_rate
FROM vendor_profiles v
LEFT JOIN orders o ON o.vendor_id = v.id
LEFT JOIN vendor_scores vs ON vs.vendor_id = v.id
WHERE v.deleted_at IS NULL
GROUP BY
  v.id,
  v.user_id,
  v.company_name_ar,
  v.company_name_en,
  v.bio_ar,
  v.bio_en,
  v.location,
  v.verification_status,
  v.avg_rating,
  v.review_count,
  vs.response_rate;

INSERT INTO site_settings (setting_key, setting_value, description)
VALUES
  ('site_name', 'Elmowared', 'Primary platform name.'),
  ('brand_palette', '{"primary":"#1e293b","secondary":"#06b6d4"}', 'Core brand colors used across the platform.')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;
