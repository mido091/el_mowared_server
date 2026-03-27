# Elmowared E-commerce & Order API Documentation

## 1. Shopping Cart
### GET `/api/cart`
- **Role**: USER
- **Header**: `Authorization: Bearer <token>`, `x-lang: ar|en`
- **Response**: List of cart items with localized product titles and prices.

### POST `/api/cart`
- **Body**: `{ "productId": 1, "quantity": 2 }`
- **Role**: USER
- **Feature**: Automatically increments quantity if product already in cart.

---

## 2. Order System (Checkout Flow)
### POST `/api/orders/checkout`
- **Body**: `{ "paymentMethod": "COD" | "WALLET" | "INSTAPAY" }`
- **Role**: USER
- **Transaction**: 
  1. Creates order records.
  2. Moves items from cart to order items (capturing current price).
  3. Clears user's cart.
  4. Auto-sends B2B chat message to Vendor.

### GET `/api/orders`
- **Role**: USER / VENDOR
- **Response**: List of orders related to the user.

### GET `/api/orders/:id`
- **Role**: USER / VENDOR
- **Response**: Full order details including items and total price.

---

## 3. Manual Payment Verification
### POST `/api/orders/:id/receipt` (Form-Data)
- **Field**: `receipt` (Image/PDF)
- **Role**: USER
- **Logic**: User uploads payment receipt for "WALLET" or "INSTAPAY" methods.

### PATCH `/api/orders/:id/confirm-payment`
- **Role**: OWNER / ADMIN
- **Logic**: Updates order status to `PROCESSING` and payment status to `VERIFIED`.

---

## Socket.io Events
- `order_update`: Sent to participants when order status changes.
