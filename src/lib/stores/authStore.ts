import { writable } from 'svelte/store';
import { auth } from '$lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, setDoc, getFirestore } from 'firebase/firestore';

interface UserData {
    uid: string;
    email: string | null;
    photoURL: string | null;
    role: 'admin' | 'manager' | 'sales' | 'staff';
}

function createAuthStore() {
    const { subscribe, set, update } = writable<{
        user: UserData | null;
        loading: boolean;
    }>({
        user: null,
        loading: true,
    });

    return {
        subscribe,
        init: () => {
            const db = getFirestore();

            onAuthStateChanged(auth, async (firebaseUser) => {
                if (firebaseUser) {
                    try {
                        const userRef = doc(db, 'users', firebaseUser.uid);
                        const userDoc = await getDoc(userRef);

                        let role: UserData['role'] = 'staff';

                        if (userDoc.exists()) {
                            role = userDoc.data().role || 'staff';
                        } else {
                            // Tạo user doc nếu chưa có (lần đầu login)
                            await setDoc(userRef, {
                                email: firebaseUser.email,
                                displayName: firebaseUser.displayName,
                                photoURL: firebaseUser.photoURL,
                                role: 'staff', // Mặc định là staff
                                createdAt: new Date()
                            });
                        }

                        set({
                            user: {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                                photoURL: firebaseUser.photoURL,
                                role: role
                            },
                            loading: false
                        });
                    } catch (error) {
                        console.error("Auth Store Error:", error);
                        // Fallback nếu lỗi mạng/quyền
                        set({
                             user: {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                                photoURL: firebaseUser.photoURL,
                                role: 'staff'
                            },
                            loading: false
                        });
                    }
                } else {
                    set({ user: null, loading: false });
                }
            });
        }
    };
}

export const authStore = createAuthStore();