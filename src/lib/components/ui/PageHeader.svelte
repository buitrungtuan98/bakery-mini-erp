<script lang="ts">
	// No script needed for this simple presentation component yet.
</script>

<header class="flex justify-between items-center mb-4 px-2">
	<h1 class="text-xl font-bold text-primary">
		<slot name="title">Page Title</slot>
	</h1>

	<div class="flex items-center gap-2">
		<slot name="actions" />
	</div>
</header>
