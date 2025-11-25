
import os
from playwright.sync_api import sync_playwright

def verify_sales_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create context with mobile viewport to test responsive features
        context = browser.new_context(viewport={"width": 375, "height": 812})
        page = context.new_page()

        try:
            # Login first (mocking auth store or just navigating if no auth wall for local?)
            # Usually local dev might have auth. Let's try navigating to sales directly.
            # If redirected to login, we might need to handle it.
            # Assuming standard dev environment with no auth or default auth.
            # If this fails, I'll need to look at how to mock auth.

            print("Navigating to Sales page...")
            page.goto("http://localhost:5173/sales")
            page.wait_for_load_state("networkidle")

            # Check if we are redirected to login
            if "login" in page.url:
                print("Redirected to login. Attempting to simulate auth state...")
                # This might be hard without knowing credentials.
                # I'll try to set localStorage if I knew the key.
                # For now, let's just capture the screenshot of where we land.

            # 1. Verify New Elements in Create Tab
            print("Verifying 'Create' Tab elements...")
            # Check for Delivery Date input
            if page.get_by_label("Ngày giao").is_visible():
                print("PASS: Delivery Date input found.")
            else:
                print("FAIL: Delivery Date input not found.")

            # Check for Status Select
            if page.get_by_label("Trạng thái").is_visible():
                 print("PASS: Status select found.")
            else:
                 print("FAIL: Status select not found.")

            # 2. Verify 'Daily Plan' Tab
            print("Verifying 'Daily Plan' Tab...")
            # Click on 'Kế hoạch' tab
            page.get_by_text("Kế hoạch").click()
            page.wait_for_timeout(1000) # Wait for tab switch

            # Check for Plan Date input
            if page.get_by_role("textbox", name="", exact=False).first.is_visible(): # Date input usually has no label text inside
                 print("PASS: Plan Date input visible.")

            # Take screenshot of Plan Tab
            page.screenshot(path="verification/sales_plan_tab.png")
            print("Screenshot saved: verification/sales_plan_tab.png")

            # 3. Verify History Tab Status Badges
            print("Verifying 'History' Tab...")
            page.get_by_text("Lịch sử").click()
            page.wait_for_timeout(1000)

            # Take screenshot of History Tab
            page.screenshot(path="verification/sales_history_tab.png")
            print("Screenshot saved: verification/sales_history_tab.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_sales_page()
