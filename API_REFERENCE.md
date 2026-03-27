# Elmowared API Reference

Welcome to the **Elmowared** Backend API documentation. This reference is designed for frontend developers to integrate the MEVN stack platform efficiently.

## 🛠️ Global Headers & Standards

### i18n Handling

The platform supports Arabic (**ar**) and English (**en**).

- **Header**: `Accept-Language: ar` or `Accept-Language: en`.
- **Behavior**: Influences localized fields like `company_name`, `title`, and `bio`.

### Authentication

- **Header**: `Authorization: Bearer <JWT_TOKEN>`
- **Token Source**: Received from `/api/v1/auth/login` or registration.

### Media & Images

- **Base URL**: Product images and logos are typically Cloudinary URLs returned in the response.
- **Default Image**: `https://res.cloudinary.com/.../default_pi1ur8.webp` (returned if no image exists).

---

## 🔐 1. Authentication & ID

`BASE_URL: /api/v1/auth`

| Method | Route               | Access | Description                      |
| :----- | :------------------ | :----- | :------------------------------- |
| `POST` | `/register/user`    | Public | Register as a Customer.          |
| `POST` | `/register/mowared` | Public | Register as a Merchant (Vendor). |
| `POST` | `/login`            | Public | Get JWT token for session.       |
| `GET`  | `/me`               | User+  | Get current session details.     |

---

## 📦 2. Products & Catalog

`BASE_URL: /api/v1/products`

| Method   | Route              | Access  | Description                                        |
| :------- | :----------------- | :------ | :------------------------------------------------- |
| `GET`    | `/`                | Public  | Search/Filter Discovery.                           |
| `GET`    | `/categories`      | Public  | **[NEW]** List all product categories. Alias for `/api/v1/categories`. Used by register vendor dropdown. |
| `GET`    | `/vendor/:vendorId`| Public  | **[NEW]** All products for a specific Vendor storefront page. Supports `?page&limit&search`. |
| `GET`    | `/compare`         | Public  | Compare multiple products by `?ids=1,2,3`.         |
| `GET`    | `/:id`             | Public  | Single product details.                            |
| `POST`   | `/`                | Vendor+ | Create product (Multi-part/images). Supports `specs` JSON. |
| `PUT`    | `/:id`             | Vendor+ | Update product.                                    |
| `DELETE` | `/:id`             | Vendor+ | Soft delete product.                               |

### Technical Specs Filtering
Search for products using technical metadata:
- **Query**: `GET /api/v1/products?specs={"resolution":"4K","ports":4}`
- **Behavior**: Performs exact match on JSON keys in the `specs` column.

---

## 💬 3. Communication (Chat)

`BASE_URL: /api/v1/chats`

| Method | Route            | Access | Description                                   |
| :----- | :--------------- | :----- | :-------------------------------------------- |
| `POST` | `/start`         | User+  | Start/Continue inquiry with product snapshot. |
| `GET`  | `/conversations` | User+  | Get latest messages/threads.                  |

### Socket.io Events

- **Auth Handshake**: Handshake must include `{ auth: { token: "JWT" } }`.
- **Room**: User automatically joins a room named after their `userId`.
- **Inbound Event**: `new_message` - Triggered when a message is sent to you.
  - Payload: `{ conversationId, message, productSnapshot }`

---

## 🛒 4. Cart (Persistent Storage)

`BASE_URL: /api/v1/cart`

| Method   | Route         | Access | Description                                   |
| :------- | :------------ | :----- | :-------------------------------------------- |
| `GET`    | `/`           | User+  | Fetch all items in current user's cart.       |
| `POST`   | `/`           | User+  | Add/Update item quantity (Atomic increments). |
| `DELETE` | `/:productId` | User+  | Remove specific item from cart.               |
| `DELETE` | `/clear`      | User+  | Empty the entire cart.                        |

---

## 🧾 5. Commerce (Escrow & Orders)

`BASE_URL: /api/v1/orders`

| Method  | Route                  | Access | Description                                  |
| :------ | :--------------------- | :----- | :------------------------------------------- |
| `POST`  | `/checkout`            | User+  | Convert cart to Escrow orders (10% Deposit). |
| `GET`   | `/`                    | User+  | List my orders (as buyer or seller).         |
| `GET`   | `/:id`                 | User+  | Order details with payment status.           |
| `POST`  | `/:id/receipt`         | User+  | Upload bank transfer image (Cloudinary).     |
| `PATCH` | `/:id/confirm-payment` | Admin+ | Approve payment -> Move to PROCESSING.       |
| `PATCH` | `/:id/status`          | Mixed  | Update lifecycle (SHIPPED, COMPLETED, etc).  |
| `GET`   | `/:id/admin-report`    | Admin+ | **[NEW]** Get 360° financial audit of an order. |
| `GET`   | `/:id/trust-report`    | Admin+ | **[NEW]** Get vendor/user trust data for an order. |

---

## ⭐ 6. Reviews & Reputation

`BASE_URL: /api/v1/reviews`

| Method | Route               | Access | Description                               |
| :----- | :------------------ | :----- | :---------------------------------------- |
| `POST` | `/`                 | User+  | Post review (Only if order is COMPLETED). |
| `GET`  | `/vendor/:vendorId` | Public | List reviews for a specific merchant.     |

---

## ⚙️ 7. Site Settings & Config

`BASE_URL: /api/v1/settings`

| Method  | Route | Access | Description                              |
| :------ | :---- | :----- | :--------------------------------------- |
| `GET`   | `/`   | Public | Fetch site name, logo, and payment info. |
| `GET`   | `/public` | Public | **[NEW]** Targeted lightweight site branding config. |
| `PATCH` | `/`   | Admin+ | Update global settings and media assets (Multi-part). |

---

## 📄 8. Quotation (1-to-1)
`BASE_URL: /api/v1/quotes`

| Method | Route | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Mixed | List my quote requests (User) or formal offers (Vendor). Returns `data: []` (Raw Array). |
| `POST` | `/request` | User+ | Request a quote for a product. Triggers Chat RFQ Card. |
| `POST` | `/:id/respond` | Vendor+ | Respond with 'OFFERED' or 'REJECTED'. |

---

## 🏗️ 9. Broad RFQ System
`BASE_URL: /api/v1/rfq`

| Method | Route | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | List open RFQs (Discovery for Vendors). |
| `POST` | `/` | User+ | Create a category-wide RFQ. Notifies matching vendors. |
| `POST` | `/:id/offers` | Vendor+ | Submit a price offer (Bid) for a specific RFQ. |
| `PATCH` | `/offers/:offerId/accept` | User+ | Accept an offer. Creates an Order with 10% deposit. |
| `GET` | `/my-offers` | Vendor+ | **[NEW]** List all bids submitted by the merchant. |

---

## 🛡️ 11. Management & Administration (Admin)
`BASE_URL: /api/v1/admin`

| Method  | Route | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET`   | `/stats` | Admin+ | Dashboard high-level statistics (Users, Sales, Growth). |
| `GET`   | `/users` | Admin+ | Full list of platform users with filtering. |
| `POST`  | `/users` | Owner+ | **[NEW]** Direct creation of new system users and vendor accounts. |
| `GET`   | `/vendors` | Admin+ | List of vendor profiles awaiting verification. |
| `PATCH` | `/users/:id/role` | Admin+ | Promote/Demote user role (Safety Gated). |
| `PATCH` | `/users/:id/status` | Admin+ | Toggle User Active/Banned status. |
| `DELETE` | `/users/:id` | Admin+ | **[SOFT DELETE]** Remove user from system. |
| `GET`   | `/logs` | Admin+ | System audit logs (Administrative actions). |

---

## 🔔 12. Alerts & Notifications
`BASE_URL: /api/v1/notifications`

| Method | Route | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | User+ | Fetch all notifications for current user. Returns `data: { notifications, unreadCount }`. |
| `PATCH` | `/:id/read` | User+ | Mark a specific notification as read. |

---

## 👑 13. System Governance (Owner)
`BASE_URL: /api/v1/owner`

| Method | Route | Access | Description |
| :--- | :--- | :--- | :--- |
| `PATCH` | `/users/:id` | Owner+ | **[MASTER OVERRIDE]** Direct edit of any user attribute (Email, Pass, Role). |

---

## ⚠️ Error Responses

| Code  | Message | Reason                                                |
| :---- | :------ | :---------------------------------------------------- |
| `400` | `fail`  | Validation Error (Zod). Check `errors` array.         |
| `401` | `error` | Unauthorized. Token missing or expired.               |
| `403` | `error` | Forbidden. Insufficient role or pending verification. |
| `404` | `error` | Not Found. Resource doesn't exist.                    |
| `500` | `error` | Internal Server Error. Transaction rollback logged.   |
