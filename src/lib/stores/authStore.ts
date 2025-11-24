import { writable } from 'svelte/store';
import { auth } from '$lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

interface UserData {
    uid: string;
    email: string | null;
    photoURL: string | null;
    role: 'admin' | 'staff' | null; // Role custom của chúng ta
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
            // Lắng nghe sự thay đổi trạng thái đăng nhập từ Firebase
            onAuthStateChanged(auth, async (firebaseUser) => {
                if (firebaseUser) {
                    // Nếu đã login, lấy thêm role từ collection 'users'
                    // Lưu ý: Lần đầu login có thể chưa có doc trong users, cần xử lý tạo mới (sẽ làm sau)
                    const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
                    const role = userDoc.exists() ? userDoc.data().role : 'staff'; // Mặc định là staff

                    set({
                        user: {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            photoURL: firebaseUser.photoURL,
                            role: role
                        },
                        loading: false
                    });
                } else {
                    set({ user: null, loading: false });
                }
            });
        }
    };
}

export const authStore = createAuthStore();