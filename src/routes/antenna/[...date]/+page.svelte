<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import App from '$lib/components/App.svelte';

	const isAntenna: boolean = true;
	let date: Date | undefined = $state();

	afterNavigate(() => {
		if (page.params.date !== undefined) {
			date = new Date(encodeURI(page.params.date));
		}
	});
</script>

<App up={{ isAntenna, date }} />
