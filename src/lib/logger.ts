// src/lib/logger.ts
import { db } from '$lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface UserInfo {
    uid: string;
    email: string | null;
}

// FIX: Bổ sung 'TRANSACTION' vào kiểu dữ liệu cho AuditLog
interface AuditLog { 
    userId: string;
    userEmail: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSACTION'; // <--- FIX 
    collection: string;
    docId: string | null;
    timestamp: any; 
    details: string; 
}

// FIX: Bổ sung 'TRANSACTION' vào tham số hàm
export async function logAction(
    user: UserInfo, 
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSACTION', // <--- FIX
    collectionName: string, 
    details: string
) {
    if (!user.uid) return;

    try {
        await addDoc(collection(db, 'system_audit_logs'), {
            userId: user.uid,
            userEmail: user.email,
            action: action,
            collection: collectionName,
            details: details,
            timestamp: serverTimestamp(),
        });
    } catch (e: any) {
        console.error("Failed to write audit log:", e);
    }
}