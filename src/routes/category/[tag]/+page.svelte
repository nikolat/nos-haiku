<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';

	let { data }: { data: PageData } = $props();
	let category: string | undefined = $state();

	afterNavigate(() => {
		category = data.params.tag.toLowerCase();
	});
</script>

<App {category} />
