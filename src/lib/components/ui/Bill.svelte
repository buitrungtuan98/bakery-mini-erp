<script lang="ts">
	import type { Order } from '$lib/types/order';

	export let order: Order;
</script>

<!--
  A4 paper is 210mm wide. Let's aim for a thermal receipt printer width, like 80mm or 58mm.
  An 80mm receipt is about 300px wide. We'll use a fixed-width container.
  The component will be targeted by html2canvas, so styling is self-contained.
-->
<div id="bill-to-print" class="w-[320px] bg-white text-black p-4 font-mono text-sm">
	<!-- Header -->
	<div class="text-center mb-4">
		<h1 class="text-2xl font-bold uppercase">Phuc Vinh Bakery</h1>
		<p>TEL: 0962158842</p>
	</div>

	<!-- Order Info -->
	<div class="mb-4 text-xs">
		<div class="flex justify-between">
			<span>No:</span>
			<span>{order.code || order.id.slice(0, 8)}</span>
		</div>
		<div class="flex justify-between">
			<span>Khách hàng:</span>
			<span>{order.customerInfo.name}</span>
		</div>
        {#if order.shippingAddress}
        <div class="flex justify-between">
            <span>Địa chỉ:</span>
            <span class="text-right max-w-[70%] truncate">{order.shippingAddress}</span>
        </div>
        {/if}
		<div class="flex justify-between">
			<span>Ngày tạo:</span>
			<span>{order.createdAt?.toDate().toLocaleString('vi-VN') || 'N/A'}</span>
		</div>
		<div class="flex justify-between">
			<span>Ngày giao:</span>
			<span>{order.deliveryDate?.toDate().toLocaleString('vi-VN') || 'N/A'}</span>
		</div>
	</div>

	<!-- Items Table -->
	<div class="border-t border-b border-dashed border-black py-2 mb-2">
		<div class="flex justify-between font-bold mb-1">
			<span class="flex-[2]">Item</span>
			<span class="flex-1 text-center">Qty</span>
			<span class="flex-1 text-right">Total</span>
		</div>
		{#each order.items as item}
            {@const priceToShow = item.originalBasePrice || item.initialPrice}
			<div class="flex justify-between mb-1">
				<div class="flex-[2]">
					<p>{item.productName}</p>
                    <!-- Pricing detail -->
					<p class="text-[10px]">
                        ({item.quantity.toLocaleString('vi-VN')} @
                        {#if item.unitPrice < priceToShow}
                            <span class="line-through">{priceToShow.toLocaleString('vi-VN')}</span>
                        {/if}
                        {item.unitPrice.toLocaleString('vi-VN')})
					</p>
				</div>
				<span class="flex-1 text-center">{item.quantity}</span>
				<span class="flex-1 text-right">{item.lineTotal.toLocaleString('vi-VN')}</span>
			</div>
		{/each}
	</div>

	<!-- Totals -->
	<div class="flex justify-between font-bold text-lg">
		<span>Total</span>
		<span>{order.totalRevenue.toLocaleString('vi-VN')} VND</span>
	</div>

    <!-- Footer -->
    <div class="text-center mt-6 text-xs">
        <p>Cảm ơn quý khách!</p>
        <p>Thank you!</p>
    </div>
</div>
