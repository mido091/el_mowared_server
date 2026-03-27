# Elmowared Escrow & Reputation API Documentation

## 1. Automatic Database Setup
Run the following command to initialize or reset the database:
```bash
node init-db.js
```
*Note: This will execute the latest schema from `src/config/schema.sql`.*

---

## 2. Advanced Escrow (Trust) Features
### Checkout with Deposit Percentage
- **Endpoint**: `POST /api/orders/checkout`
- **Body**: 
  ```json
  {
    "paymentMethod": "WALLET",
    "depositAmount": 500
  }
  ```
- **Logic**: Automatically captures `deposit_percentage` from vendor settings and snapshots it into the order.

### Admin Trust Report (Owner Package)
- **Endpoint**: `GET /api/orders/:id/trust-report`
- **Role**: OWNER / ADMIN
- **Response**: Joins User, Vendor, Order, and Payments to provide a complete verification view.

### Payment Verification with Notes
- **Endpoint**: `POST /api/orders/:id/verify-payment`
- **Body**:
  ```json
  {
    "status": "VERIFIED" | "REJECTED",
    "note": "Reason for rejection or verification details"
  }
  ```
- **Notifications**:
    - `VERIFIED`: Notifies Vendor to start and User of success.
    - `REJECTED`: Notifies User with the rejection reason.

---

## 3. Reputation (Vendor Stats)
### Vendor Statistics (SQL View)
- **Repo Method**: `VendorRepository.findById`
- **Fields**: `avg_rating`, `review_count`, `total_sales`, `total_orders`.
- **Source**: Powered by `vendor_stats` SQL View for maximum performance.

### Verified Reviews
- **Endpoint**: `POST /api/reviews`
- **Restriction**: Order status MUST be `COMPLETED`. 
- **Language**: Error messages localized (`ar/en`).
