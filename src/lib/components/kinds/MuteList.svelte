<script lang="ts">
	import { getRoboHashURL } from '$lib/config';
	import type { RelayConnector } from '$lib/resource';
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools';
	import * as nip19 from 'nostr-tools/nip19';
	import { _ } from 'svelte-i18n';

	let {
		rc,
		loginPubkey,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashtags,
		eventMuteList,
		isAuthor
	}: {
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashtags: string[];
		eventMuteList: NostrEvent | undefined;
		isAuthor: boolean;
	} = $props();

	const mutedChannels: ChannelContent[] = $derived(
		mutedChannelIds.map((id) => channelMap.get(id)).filter((cc) => cc !== undefined)
	);
</script>

<div class="Settings__section">
	<div class="Label">
		<i class="fa-fw fas fa-user-minus"></i>
		<span>{$_('MuteList.muted-users')}</span>
		{#if isAuthor}
			<p class="Tip">{$_('MuteList.muted-users-tips')}</p>
		{/if}
	</div>
	<div class="Control">
		<div class="BlockList">
			<div class="BlockList__container">
				<ul>
					{#each mutedPubkeys as pubkey (pubkey)}
						{@const prof = profileMap.get(pubkey)}
						<li style="">
							<div>
								<a href="/{nip19.npubEncode(pubkey)}"
									><img alt="" src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(pubkey))} /></a
								>
							</div>
							<div>
								<p>{prof?.display_name ?? ''} (id:{prof?.name ?? ''})</p>
							</div>
							{#if isAuthor}
								<div>
									<button
										class="Button Button--warn"
										aria-label={$_('MuteList.unmute')}
										onclick={() => {
											if (loginPubkey !== undefined) {
												rc?.unmutePubkey(pubkey, loginPubkey, eventMuteList);
											}
										}}><i class="fa-fw fas fa-trash-alt"></i></button
									>
								</div>
							{/if}
						</li>
					{:else}
						<li>{$_('MuteList.nothing-muted')}</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
</div>
<div class="Settings__section">
	<div class="Label">
		<i class="fa-fw fas fa-tags"></i>
		<span>{$_('MuteList.muted-keywords')}</span>
		{#if isAuthor}
			<p class="Tip">{$_('MuteList.muted-keywords-tips')}</p>
		{/if}
	</div>
	<div class="Control">
		<div class="BlockList">
			<div class="BlockList__container">
				<ul>
					{#each mutedChannels as channel (channel.id)}
						<li>
							<div>
								<a href="/keyword/{nip19.neventEncode({ id: channel.id })}">
									<img
										alt=""
										src={URL.canParse(channel.picture ?? '')
											? channel.picture
											: getRoboHashURL(nip19.neventEncode({ id: channel.id }))}
									/>
								</a>
							</div>
							<div>
								<p>{channel.name}</p>
							</div>
							{#if isAuthor}
								<div>
									<button
										class="Button Button--warn"
										aria-label={$_('MuteList.unmute')}
										onclick={() => {
											if (loginPubkey !== undefined) {
												rc?.unmuteChannel(channel.id, loginPubkey, eventMuteList);
											}
										}}><i class="fa-fw fas fa-trash-alt"></i></button
									>
								</div>
							{/if}
						</li>
					{:else}
						<li>{$_('MuteList.nothing-muted')}</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
</div>
{#if mutedWords.length > 0}
	<div class="Settings__section">
		<div class="Label">
			<i class="fa-fw fas fa-tags"></i> <span>{$_('MuteList.muted-words')}</span>
			{#if isAuthor}
				<p class="Tip">{$_('MuteList.muted-words-tips')}</p>
			{/if}
		</div>
		<div class="Control">
			<div class="BlockList">
				<div class="BlockList__container">
					<ul>
						{#each mutedWords as word (word)}
							<li>
								<div>
									<p>{word}</p>
								</div>
								{#if isAuthor}
									<div>
										<button
											class="Button Button--warn"
											aria-label={$_('MuteList.unmute')}
											onclick={() => {
												if (loginPubkey !== undefined) {
													rc?.unmuteWord(word, loginPubkey, eventMuteList);
												}
											}}><i class="fa-fw fas fa-trash-alt"></i></button
										>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	</div>
{/if}
{#if mutedHashtags.length > 0}
	<div class="Settings__section">
		<div class="Label">
			<i class="fa-fw fas fa-tags"></i>
			<span>{$_('MuteList.muted-hashtags')}</span>
			{#if isAuthor}
				<p class="Tip">{$_('MuteList.muted-hashtags-tips')}</p>
			{/if}
		</div>
		<div class="Control">
			<div class="BlockList">
				<div class="BlockList__container">
					<ul>
						{#each mutedHashtags as hashTag (hashTag)}
							<li>
								<div>
									<p>#{hashTag}</p>
								</div>
								{#if isAuthor}
									<div>
										<button
											class="Button Button--warn"
											aria-label={$_('MuteList.unmute')}
											onclick={() => {
												if (loginPubkey !== undefined) {
													rc?.unmuteHashtag(hashTag, loginPubkey, eventMuteList);
												}
											}}><i class="fa-fw fas fa-trash-alt"></i></button
										>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	</div>
{/if}
