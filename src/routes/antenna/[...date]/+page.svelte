<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';

	const isAntenna: boolean = true;
	let date: Date | undefined = $state();

	afterNavigate(() => {
		date = new Date(page.params.date);
	});
</script>

<App up={{ isAntenna, date }} />
