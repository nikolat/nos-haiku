<script lang="ts">
	import type { PageData } from './$types';
	import { afterNavigate } from '$app/navigation';
	import App from '$lib/components/App.svelte';

	let { data }: { data: PageData } = $props();
	let hashtag: string | undefined = $state();

	afterNavigate(() => {
		hashtag = data.params.tag;
	});
</script>

<App {hashtag} />
