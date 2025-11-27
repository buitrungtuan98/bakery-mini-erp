import { db } from '$lib/firebase';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    getDocs,
    serverTimestamp
} from 'firebase/firestore';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';

export interface UserProfile {
    id: string;
    email: string;
    displayName?: string;
    role: string;
    createdAt?: any;
}

export interface Invite {
    id: string;
    email: string;
    role: string;
    createdAt?: any;
}

export const userService = {
    async fetchUsers() {
        const q = query(collection(db, 'users'), orderBy('email'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
    },

    async fetchInvites() {
        const q = query(collection(db, 'invited_emails'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invite));
    },

    async inviteUser(user: User, email: string, role: string) {
        // Business check: Should be done in UI usually, but good to double check or catch error
        // Checking existing users/invites is expensive here without passing the lists,
        // so we assume the UI did the validation or we let Firestore rules handle unique constraints if set (usually not for simple arrays).

        await addDoc(collection(db, 'invited_emails'), {
            email: email,
            role: role,
            createdAt: serverTimestamp(),
            createdBy: user.email
        });
        await logAction(user, 'CREATE', 'invited_emails', `Mời ${email} làm ${role}`);
    },

    async cancelInvite(user: User, id: string) {
        await deleteDoc(doc(db, 'invited_emails', id));
        // await logAction(user, 'DELETE', 'invited_emails', `Hủy lời mời ID: ${id}`);
    },

    async updateUserRole(user: User, targetUserId: string, targetUserEmail: string, newRole: string) {
        const userRef = doc(db, 'users', targetUserId);
        await updateDoc(userRef, { role: newRole });
        await logAction(user, 'UPDATE', 'users', `Phân quyền ${targetUserEmail} -> ${newRole}`);
    },

    async deleteUser(user: User, targetUserId: string, targetUserEmail: string) {
        await deleteDoc(doc(db, 'users', targetUserId));
        await logAction(user, 'DELETE', 'users', `Xóa user: ${targetUserEmail}`);
    }
};
