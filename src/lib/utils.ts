import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '$lib/firebase';

/**
 * Generates the next code for a document in a collection based on a prefix.
 * Format: PREFIX-00000001 (8 digits)
 * @param collectionName Name of the Firestore collection
 * @param prefix The prefix string (e.g., 'KH', 'NCC')
 * @param length Number of digits for the numeric part (default 8)
 * @returns The generated code string
 */
export async function generateNextCode(collectionName: string, prefix: string, length: number = 8): Promise<string> {
    try {
        // Query for the latest code with the given prefix
        // We use a range filter to ensure we only get codes starting with the prefix
        // and then order by code descending to get the highest one.
        const q = query(
            collection(db, collectionName),
            where('code', '>=', prefix),
            where('code', '<=', prefix + '\uf8ff'),
            orderBy('code', 'desc'),
            limit(1)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            // No existing code with this prefix, start with 1
            return `${prefix}-${'1'.padStart(length, '0')}`;
        }

        const latestDoc = snapshot.docs[0];
        const latestCode = latestDoc.data().code as string;

        if (!latestCode || !latestCode.startsWith(prefix + '-')) {
             // Fallback if the found code doesn't match expected format (shouldn't happen with the query)
             return `${prefix}-${'1'.padStart(length, '0')}`;
        }

        // Extract the numeric part
        const numericPart = latestCode.substring(prefix.length + 1); // +1 for the hyphen
        const currentNumber = parseInt(numericPart, 10);

        if (isNaN(currentNumber)) {
             return `${prefix}-${'1'.padStart(length, '0')}`;
        }

        const nextNumber = currentNumber + 1;
        return `${prefix}-${nextNumber.toString().padStart(length, '0')}`;

    } catch (error: any) {
        console.error(`Error generating next code for ${collectionName} with prefix ${prefix}:`, error);
        // Fallback: use timestamp or random to avoid blocking, but ideally we want sequential.
        // For now, let's throw or return a safe default that indicates an issue or retry.
        // Given the "Small company" context, we might just return a timestamp-based fallback if it fails,
        // but strictly sequential is requested.
        // We will rethrow so the UI can handle or alert.
        throw error;
    }
}
