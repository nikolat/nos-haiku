<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';

	let { data }: { data: PageData } = $props();
	let query: string | undefined = $state();

	afterNavigate(() => {
		query = data.params.query;
	});
</script>

<App {query} />
