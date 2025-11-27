<script lang="ts">
	import { auth, googleProvider, db } from '$lib/firebase';
	import { signInWithPopup, signOut } from 'firebase/auth';
	import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/authStore';
    import { quintOut } from 'svelte/easing';
    import { fade, fly } from 'svelte/transition';

	let errorMsg = '';
	let isLoading = false;

	// Nếu user đã đăng nhập rồi mà cố vào trang login, đá về trang chủ
	$: if ($authStore.user) {
		goto('/');
	}

	async function handleGoogleLogin() {
		isLoading = true;
		errorMsg = '';

		try {
			// 1. Trigger Google Popup
			const result = await signInWithPopup(auth, googleProvider);
			const user = result.user;

			// 2. Kiểm tra xem User đã tồn tại trong Firestore chưa
			const userRef = doc(db, 'users', user.uid);
			const userSnap = await getDoc(userRef);

			if (!userSnap.exists()) {
				// --- KIỂM TRA LỜI MỜI (INVITATION CHECK) ---
                const inviteQuery = query(collection(db, 'invited_emails'), where('email', '==', user.email));
                const inviteSnap = await getDocs(inviteQuery);

                if (inviteSnap.empty) {
                    // Nếu không có lời mời -> Từ chối đăng nhập
                    await signOut(auth); // Đăng xuất ngay lập tức
                    errorMsg = `Email "${user.email}" chưa được mời tham gia hệ thống. Vui lòng liên hệ Admin.`;
                    isLoading = false;
                    return;
                }

                // Lấy role đã được assign trong lời mời
                const inviteData = inviteSnap.docs[0].data();
                const assignedRole = inviteData.role || 'staff';

				// 3. Nếu có lời mời, tạo User mới với role đã định
				await setDoc(userRef, {
					email: user.email,
					displayName: user.displayName,
					photoURL: user.photoURL,
					role: assignedRole,
					createdAt: serverTimestamp(),
					lastLogin: serverTimestamp()
				});
			} else {
				// 4. Nếu đã tồn tại, update thời gian login cuối
				await setDoc(userRef, {
					lastLogin: serverTimestamp()
				}, { merge: true });
			}

			// Chuyển hướng về Dashboard
			goto('/');

		} catch (error: any) {
			console.error("Login error:", error);
			errorMsg = "Đăng nhập thất bại. Vui lòng thử lại.";
            await signOut(auth); // Ensure clean state
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">

    <div class="w-full max-w-sm mb-8 text-center" in:fly={{ y: -20, duration: 800, delay: 100 }}>
        <h1 class="text-4xl font-extrabold text-primary mb-2 tracking-tight">Bánh Mì Boss</h1>
        <p class="text-slate-500 text-lg font-light">Hệ thống quản lý sản xuất</p>
    </div>

    <div class="card w-full max-w-sm bg-white shadow-xl shadow-slate-200 border border-slate-100" in:fly={{ y: 20, duration: 800, delay: 200 }}>
        <div class="card-body p-8">
            <h2 class="text-2xl font-bold text-center text-slate-800 mb-6">Xin chào!</h2>

            {#if errorMsg}
                <div class="alert alert-error text-white text-sm mb-6 shadow-md" transition:fade>
                    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>{errorMsg}</span>
                </div>
            {/if}

            <div class="form-control">
                <button
                    class="btn btn-primary h-14 text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-[0.98]"
                    on:click={handleGoogleLogin}
                    disabled={isLoading}
                >
                    {#if isLoading}
                        <span class="loading loading-spinner loading-sm"></span>
                    {:else}
                        <div class="flex items-center gap-3">
                            <svg class="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M21.35 11.1H12v2.8h5.3c-.2 1.2-.9 2.2-2 2.9v2.4h3.2c1.9-1.7 3-4.3 3-7.2 0-.5-.1-1-.2-1.5z" fill="#4285F4" />
                                <path d="M12 21c2.6 0 4.8-.9 6.4-2.3l-3.2-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.6-1.7-5.4-4h-3.3v2.6C5 19.3 8.2 21 12 21z" fill="#34A853" />
                                <path d="M6.6 14.3c-.2-.6-.3-1.2-.3-1.9s.1-1.2.3-1.9v-2.6H3.3C2.1 9.9 1.4 12 1.4 14.3c0 2.3.7 4.3 1.9 6.3l3.3-2.6z" fill="#FBBC05" />
                                <path d="M12 4.8c1.4 0 2.6.5 3.6 1.4l2.7-2.7C16.8 1.9 14.6 1 12 1 8.2 1 5 2.7 3.3 6.4l3.3 2.6c.8-2.3 2.9-4 5.4-4z" fill="#EA4335" />
                            </svg>
                            <span>Tiếp tục với Google</span>
                        </div>
                    {/if}
                </button>
            </div>

            <div class="mt-8 text-center">
                <p class="text-xs text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                    Hệ thống dành riêng cho nội bộ.
                    <br>Vui lòng liên hệ Admin để cấp quyền.
                </p>
            </div>
        </div>
    </div>

    <div class="mt-8 text-slate-300 text-xs font-mono">
        v2.0.0
    </div>
</div>