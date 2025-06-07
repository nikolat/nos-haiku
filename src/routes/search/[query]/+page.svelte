<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';

	let query: string | undefined = $state();

	afterNavigate(() => {
		query = page.params.query;
	});
</script>

<App up={{ query }} />
