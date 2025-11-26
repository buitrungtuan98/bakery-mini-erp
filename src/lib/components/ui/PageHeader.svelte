<script lang="ts">
	export let title: string;
</script>

<div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4 px-2 md:px-0">
	<h1 class="text-xl font-bold text-primary">{title}</h1>
	<div class="action-slot">
		<slot name="action" />
	</div>
</div>
