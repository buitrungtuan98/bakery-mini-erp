import { writable } from 'svelte/store';
import { auth } from '$lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

interface UserData {
    uid: string;
    email: string | null;
    photoURL: string | null;
    role: 'admin' | 'manager' | 'sales' | 'staff' | null;
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

                        let role: UserData['role'] = null;

                        if (userDoc.exists()) {
                            role = userDoc.data().role || 'staff';
                        }
                        // REMOVED: Auto-create logic.
                        // Creation is now handled exclusively in /login page after invite check.

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
                        set({
                             user: {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                                photoURL: firebaseUser.photoURL,
                                role: null
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