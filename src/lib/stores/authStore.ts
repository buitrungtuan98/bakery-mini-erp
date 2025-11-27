import { writable } from 'svelte/store';
import { auth } from '$lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { permissionStore } from './permissionStore';

interface UserData {
    uid: string;
    email: string | null;
    photoURL: string | null;
    role: string | null; // Changed from strict union to string to support dynamic roles
}

function createAuthStore() {
    const { subscribe, set } = writable<{
        user: UserData | null;
        loading: boolean;
    }>({
        user: null,
        loading: true,
    });

    return {
        subscribe,
        init: async () => {
            const db = getFirestore();

            // 1. Start by loading Roles definition
            await permissionStore.initRoles();

            onAuthStateChanged(auth, async (firebaseUser) => {
                if (firebaseUser) {
                    try {
                        const userRef = doc(db, 'users', firebaseUser.uid);
                        const userDoc = await getDoc(userRef);

                        let role: string = 'staff';

                        if (userDoc.exists()) {
                            role = userDoc.data().role || 'staff';
                        }

                        // 2. Set Permissions based on fetched role
                        permissionStore.setUserRole(role);

                        set({
                            user: {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                                photoURL: firebaseUser.photoURL,
                                role: role
                            },
                            loading: false
                        });
                    } catch (error: any) {
                        console.error("Auth Store Error:", error);
                        permissionStore.setUserRole('staff');
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