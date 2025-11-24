<script lang="ts">
	import { auth, googleProvider, db } from '$lib/firebase';
	import { signInWithPopup, signOut } from 'firebase/auth';
	import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/authStore';

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

                // (Tùy chọn) Xóa lời mời sau khi đăng ký thành công?
                // Ở đây ta giữ lại hoặc xóa đều được. Xóa để tránh rác.
                // Nhưng vì rules hiện tại chỉ cho Admin write, nên user không tự xóa được.
                // Ta có thể bỏ qua bước xóa này, hoặc admin sẽ tự dọn dẹp.
                // Để đơn giản, ta cứ để lời mời đó.
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

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content flex-col lg:flex-row-reverse">
		<div class="text-center lg:text-left max-w-md ml-0 lg:ml-10 mb-10 lg:mb-0">
			<h1 class="text-5xl font-bold text-primary">Hệ thống quản lý</h1>
			<p class="py-6">
				Quản lý dòng tiền, kho hàng và tính giá vốn thực tế. 
				Đăng nhập để bắt đầu phiên làm việc.
			</p>
		</div>
		
		<div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
			<div class="card-body">
				<h2 class="card-title justify-center mb-4">Đăng nhập</h2>
				
				{#if errorMsg}
					<div class="alert alert-error text-sm mb-4">
						<span>{errorMsg}</span>
					</div>
				{/if}

				<div class="form-control mt-6">
					<button 
						class="btn btn-primary gap-2" 
						on:click={handleGoogleLogin} 
						disabled={isLoading}
					>
						{#if isLoading}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
								<path d="M21.35 11.1H12v2.8h5.3c-.2 1.2-.9 2.2-2 2.9v2.4h3.2c1.9-1.7 3-4.3 3-7.2 0-.5-.1-1-.2-1.5z" fill="#4285F4" />
								<path d="M12 21c2.6 0 4.8-.9 6.4-2.3l-3.2-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.6-1.7-5.4-4h-3.3v2.6C5 19.3 8.2 21 12 21z" fill="#34A853" />
								<path d="M6.6 14.3c-.2-.6-.3-1.2-.3-1.9s.1-1.2.3-1.9v-2.6H3.3C2.1 9.9 1.4 12 1.4 14.3c0 2.3.7 4.3 1.9 6.3l3.3-2.6z" fill="#FBBC05" />
								<path d="M12 4.8c1.4 0 2.6.5 3.6 1.4l2.7-2.7C16.8 1.9 14.6 1 12 1 8.2 1 5 2.7 3.3 6.4l3.3 2.6c.8-2.3 2.9-4 5.4-4z" fill="#EA4335" />
							</svg>
						{/if}
						Đăng nhập với Google
					</button>
				</div>
				<div class="divider">Hoặc</div>
				<p class="text-center text-sm text-gray-500">Hệ thống yêu cầu lời mời từ Admin. Nếu bạn chưa có, vui lòng liên hệ Admin.</p>
			</div>
		</div>
	</div>
</div>