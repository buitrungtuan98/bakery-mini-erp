import { auth, googleProvider } from '$lib/firebase';
import { signInWithPopup, reauthenticateWithPopup, GoogleAuthProvider, type UserCredential } from 'firebase/auth';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

class GoogleSheetService {
    private accessToken: string | null = null;

    /**
     * Authenticates the user with Google to get an Access Token for Sheets API.
     * This must be triggered by a user action (button click).
     */
    async connect(): Promise<boolean> {
        try {
            // Add the scope to the provider
            googleProvider.addScope(SCOPE);

            let result: UserCredential;

            if (auth.currentUser) {
                // If already logged in, try to re-auth to get new scope/token
                // reauthenticateWithPopup is safer as it keeps the same user context
                result = await reauthenticateWithPopup(auth.currentUser, googleProvider);
            } else {
                 // If not logged in (should not happen in this app context often), sign in
                result = await signInWithPopup(auth, googleProvider);
            }

            const credential = GoogleAuthProvider.credentialFromResult(result);

            if (credential && credential.accessToken) {
                this.accessToken = credential.accessToken;
                console.log('Google Sheets Connected Successfully');
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error connecting to Google Sheets:', error);
            // If re-auth fails (e.g. user closed popup), we might try regular sign-in as fallback
            // but for now, throw to UI
            throw error;
        }
    }

    /**
     * Checks if we have a valid token (rudimentary check).
     */
    isConnected(): boolean {
        return !!this.accessToken;
    }

    private getHeaders() {
        if (!this.accessToken) throw new Error('Not connected to Google Sheets. Call connect() first.');
        return {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Reads data from a specific range.
     * returns values[][]
     */
    async readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Read Sheet Error: ${err.error.message}`);
        }

        const data = await response.json();
        return data.values || [];
    }

    /**
     * Appends data to a sheet.
     */
    async appendData(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                values: values
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Append Data Error: ${err.error.message}`);
        }
    }

    /**
     * Clears a range (useful before full sync/rewrite).
     */
    async clearRange(spreadsheetId: string, range: string): Promise<void> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders()
        });

         if (!response.ok) {
            const err = await response.json();
            throw new Error(`Clear Range Error: ${err.error.message}`);
        }
    }

    /**
     * Create a new spreadsheet
     */
    async createSpreadsheet(title: string): Promise<string> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets`;
        const response = await fetch(url, {
             method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                properties: {
                    title: title
                }
            })
        });

         if (!response.ok) {
            const err = await response.json();
            throw new Error(`Create Spreadsheet Error: ${err.error.message}`);
        }

        const data = await response.json();
        return data.spreadsheetId;
    }

    /**
     * Updates a specific cell or range.
     */
    async updateCell(spreadsheetId: string, range: string, value: string | number): Promise<void> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify({
                values: [[value]]
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Update Cell Error: ${err.error.message}`);
        }
    }

    /**
     * Updates a full row or range with array of values.
     */
    async updateRow(spreadsheetId: string, range: string, values: any[]): Promise<void> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify({
                values: [values]
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Update Row Error: ${err.error.message}`);
        }
    }

    /**
     * Clears a range (e.g., a row).
     */
    async clearRow(spreadsheetId: string, range: string): Promise<void> {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders()
        });

         if (!response.ok) {
            const err = await response.json();
            throw new Error(`Clear Row Error: ${err.error.message}`);
        }
    }

    /**
     * Ensure a sheet (tab) exists, if not create it with header row.
     */
    async ensureSheet(spreadsheetId: string, sheetTitle: string, headers: string[]): Promise<void> {
        // 1. Get spreadsheet metadata to check existing sheets
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
        const response = await fetch(url, { headers: this.getHeaders() });
        const data = await response.json();

        const sheetExists = data.sheets.some((s: any) => s.properties.title === sheetTitle);

        if (!sheetExists) {
            // Create Sheet
            const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
            await fetch(batchUpdateUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: sheetTitle
                                }
                            }
                        }
                    ]
                })
            });

            // Write Headers
            await this.appendData(spreadsheetId, `${sheetTitle}!A1`, [headers]);
        } else {
            // Check if headers exist (Read A1:Z1)
            const currentHeaders = await this.readSheet(spreadsheetId, `${sheetTitle}!A1:Z1`);
            if (!currentHeaders || currentHeaders.length === 0) {
                 await this.appendData(spreadsheetId, `${sheetTitle}!A1`, [headers]);
            }
        }
    }
}

export const googleSheetService = new GoogleSheetService();
