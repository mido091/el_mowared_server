# Elmowared B2B API Documentation

## Authentication
### POST `/api/auth/register`
- **Body**: `{ email, password, firstName, lastName, isVendor, companyName, bioAr, bioEn, categoryIds: [] }`
- **Role**: Public

### POST `/api/auth/login`
- **Body**: `{ email, password }`
- **Role**: Public

---

## Products
### GET `/api/products`
- **Query**: `category, vendor, search, page, limit`
- **Role**: Public
- **Features**: Localized search in titles and category names.

### POST `/api/products` (Form-Data)
- **Body**: `{ titleAr, titleEn, descAr, descEn, categoryId, images: [] }`
- **Role**: VENDOR (Approved)

---

## Chats & Inquiries
### POST `/api/chats/inquiry`
- **Body**: `{ vendorId, productId, messageText, requestedQuantity }`
- **Role**: USER
- **Logic**: Automatically snaps product context and sets message type to `INQUIRY`.

### GET `/api/chats`
- **Role**: USER/VENDOR
- **Feature**: Returns conversations with latest message and product context.

---

## Notifications
### GET `/api/notifications`
- **Role**: USER/VENDOR
- **Feature**: Paginated system alerts.

---

## Socket.io Events
- `new_message`: Sent when a message is received in a conversation.
- `notification`: Sent for system-wide alerts.
