import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    Timestamp,
    query,
    orderBy,
    limit,
    onSnapshot,
    where,
    getDocs,
    writeBatch
} from 'firebase/firestore';
import type { FinanceLedger } from '$lib/types/erp';
import type { User } from 'firebase/auth';

export const financeService = {
    /**
     * Record a financial entry (Revenue or Expense)
     */
    async recordEntry(
        user: User,
        details: {
            type: 'revenue' | 'expense';
            category: string;
            amount: number;
            description: string;
            relatedDocId?: string;
        }
    ) {
        // Validation
        if (details.amount <= 0) throw new Error("Amount must be positive");

        await runTransaction(db, async (transaction) => {
            const ref = doc(collection(db, 'finance_ledger'));
            const entry: FinanceLedger = {
                id: ref.id,
                date: Timestamp.now(),
                type: details.type,
                category: details.category,
                amount: details.amount,
                description: details.description,
                relatedDocId: details.relatedDocId,
                recordedBy: user.email || 'unknown'
            };
            transaction.set(ref, entry);
        });
    },

    /**
     * Subscribe to Finance Ledger
     */
    subscribeLedger(limitCount: number, callback: (entries: FinanceLedger[]) => void) {
        const q = query(collection(db, 'finance_ledger'), orderBy('date', 'desc'), limit(limitCount));
        return onSnapshot(q, (snapshot) => {
            const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceLedger));
            callback(entries);
        });
    },

    /**
     * Cancel (Soft Delete) all finance entries related to a document
     */
    async cancelEntriesByRelatedDoc(relatedDocId: string) {
        if (!relatedDocId) return;

        const q = query(collection(db, 'finance_ledger'), where('relatedDocId', '==', relatedDocId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) return;

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { status: 'canceled' });
        });
        await batch.commit();
    }
};
