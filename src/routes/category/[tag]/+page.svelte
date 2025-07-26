<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';

	let category: string | undefined = $state();

	afterNavigate(() => {
		if (page.params.tag !== undefined) {
			category = page.params.tag.toLowerCase();
		}
	});
</script>

<App up={{ category }} />
