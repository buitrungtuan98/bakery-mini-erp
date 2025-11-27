# Bakery Mini ERP

A specialized ERP system for small bakeries, built with **SvelteKit**, **Tailwind CSS**, and **Firebase (Firestore)**. Designed to manage the entire lifecycle from Import -> Production -> Sales with strict inventory control.

## 🏗 System Architecture

The application follows a **Standard ERP Architecture** adapted for NoSQL (Firestore), separating Master Data from Transactional Data to ensure scalability and integrity.

### 1. Database Schema

#### Master Data (Configuration)
*Prefix: `master_`*
*   **`master_products`**: Finished goods sold to customers. Includes BOM (Bill of Materials/Recipe).
*   **`master_ingredients`**: Raw materials used in production. Tracks `currentStock` and `avgCost` (Weighted Average Cost).
*   **`master_partners`**: Customers, Suppliers, and Manufacturers.
*   **`master_assets`**: Tools and Equipment.
*   **`master_expense_categories`**: Financial categories for expense tracking.

#### Transactional Data (Operations)
*   **`sales_orders`**: Customer orders. Deducts finished goods stock upon creation (Reservation Strategy).
*   **`production_runs`**: Records of baking. Deducts Ingredients (Raw) and adds Products (Finished).
*   **`imports`**: Purchase receipts. Adds Ingredient stock and updates Average Cost.
*   **`finance_ledger`**: Unified financial journal for Expenses and Revenues.
*   **`inventory_transactions`**: **Immutable Log** of ALL stock movements. Source of Truth for inventory audits.
*   **`system_audit_logs`**: System-level user activity logs.

### 2. Core Logic

*   **Inventory Engine**: A centralized service (`inventoryService`) that uses Atomic Firestore Transactions to update the *Master Snapshot* (e.g., `currentStock` on an Ingredient) AND write a *Transaction Log* (`inventory_transactions`) simultaneously. This guarantees data integrity.
*   **Costing**: Uses **Weighted Average Cost (WAC)** for ingredients. Product cost (`costPrice`) is theoretical, based on the BOM and current ingredient costs.

## 📂 Project Structure

*   **`/src/routes`**:
    *   **`/`**: Dashboard (Financial Overview, Low Stock Alerts).
    *   **`/sales`**: POS & Order Management.
    *   **`/production`**: Production Planning & Execution.
    *   **`/imports`**: Material Receiving.
    *   **`/expenses`**: Expense Tracking.
    *   **`/stocktake`**: Inventory Adjustments & Audit.
    *   **`/master`**: Centralized Master Data Management (Products, Ingredients, Partners, Assets).
    *   **`/reports`**: Financial & Operational Reports.
    *   **`/admin`**: User & Role Management.

## 🚀 Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Run Development Server**:
    ```bash
    npm run dev
    ```
3.  **Build for Production**:
    ```bash
    npm run build
    ```

## 🔐 Permissions

Role-Based Access Control (RBAC) is implemented via `firestore.rules` and frontend stores. Roles are defined in the `roles` collection.
*   **Admin**: Full Access.
*   **Manager**: Inventory, Production, Finance.
*   **Sales**: POS Only.
*   **Staff**: Limited View.
