<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import { browser } from '$app/environment';
	import type { RelayRecord } from 'nostr-tools/relay';
	import * as nip11 from 'nostr-tools/nip11';
	import * as nip19 from 'nostr-tools/nip19';

	let {
		relaysToUse,
		showIcon = false
	}: {
		relaysToUse: RelayRecord;
		showIcon?: boolean;
	} = $props();
</script>

<table>
	<tbody>
		<tr>
			{#if browser && showIcon}
				<th></th>
			{/if}
			<th>relay</th>
			<th>r</th>
			<th>w</th>
		</tr>
		{#each Object.entries(relaysToUse) as relay (relay[0])}
			<tr>
				{#if browser && showIcon}
					<td>
						{#await nip11.fetchRelayInformation(relay[0]) then r}
							{#if URL.canParse(r.icon ?? '')}
								<img src={r.icon} alt={r.name} />
							{:else if r.pubkey !== undefined}
								<img src={getRoboHashURL(nip19.npubEncode(r.pubkey))} alt={r.name} />
							{/if}
						{:catch error}
							{console.warn(error.message)}
						{/await}
					</td>
				{/if}
				<td>{relay[0]}</td>
				<td><input type="checkbox" checked={relay[1].read} name="read" disabled /></td>
				<td><input type="checkbox" checked={relay[1].write} name="write" disabled /></td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		table-layout: auto;
		width: auto;
	}
	table th {
		text-align: center;
		padding: 1px 1em;
		background-color: var(--background-secondary);
	}
	table td {
		white-space: pre-wrap;
		padding: 1px 1em;
	}
	table tr:nth-child(odd) td {
		background-color: var(--background-secondary);
	}
	table td img {
		width: 16px;
		height: 16px;
	}
</style>
