<script lang="ts">
	import { getClientURL, getRoboHashURL } from '$lib/config';
	import { getRelativetime, zap, type ChannelContent, type ProfileContentEvent } from '$lib/utils';
	import {
		getEventById,
		getProfileName,
		getRelaysToUse,
		sendDeletion,
		sendRepost
	} from '$lib/resource.svelte';
	import Reaction from '$lib/components/Reaction.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import Content from '$lib/components/Content.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';

	let {
		event,
		channelMap,
		profileMap,
		loginPubkey,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		eventsTimeline,
		eventsReaction,
		uploaderSelected,
		channelToPost = $bindable(),
		currentChannelId,
		nowRealtime,
		level
	}: {
		event: NostrEvent;
		channelMap: Map<string, ChannelContent>;
		profileMap: Map<string, ProfileContentEvent>;
		loginPubkey: string | undefined;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		eventsTimeline: NostrEvent[];
		eventsReaction: NostrEvent[];
		uploaderSelected: string;
		channelToPost: ChannelContent | undefined;
		currentChannelId: string | undefined;
		nowRealtime: number;
		level: number;
	} = $props();

	const getRootId = (event: NostrEvent | undefined): string | undefined => {
		if (event === undefined) {
			return undefined;
		}
		const rootId = event.tags
			.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
			?.at(1);
		if (rootId === undefined) {
			return undefined;
		}
		try {
			nip19.neventEncode({ id: rootId });
		} catch (_error) {
			return undefined;
		}
		return rootId;
	};
	const channelId: string | undefined = $derived.by(() => {
		if (event.kind !== 42) {
			return undefined;
		}
		return getRootId(event);
	});
	const channel: ChannelContent | undefined = $derived(channelMap.get(channelId ?? ''));
	const eventsReactionToTheEvent: NostrEvent[] = $derived(
		eventsReaction.filter(
			(ev) =>
				ev.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.at(-1)
					?.at(1) === event.id && !mutedPubkeys.includes(event.pubkey)
		)
	);
	const isMutedPubkey: boolean = $derived(mutedPubkeys.includes(event.pubkey));
	const isMutedChannel: boolean = $derived(mutedChannelIds.includes(channelId ?? ''));
	const isMutedContent: boolean = $derived(mutedWords.some((word) => event.content.includes(word)));
	const urlViaAP: string | undefined = $derived(
		event.tags
			.find((tag) => tag.length >= 3 && tag[0] === 'proxy' && tag[2] === 'activitypub')
			?.at(1)
	);
	const clientInfo: { name: string; url: string } | undefined = $derived.by(() => {
		const tag = event.tags.find((tag) => tag.length >= 3 && tag[0] === 'client');
		if (tag === undefined || tag[2] === undefined) {
			return undefined;
		}
		const sp = tag[2].split(':');
		if (sp.length < 3 || !/^\d+$/.test(sp[0])) {
			return undefined;
		}
		const ap: nip19.AddressPointer = { identifier: sp[2], pubkey: sp[1], kind: parseInt(sp[0]) };
		const relayHint = URL.canParse(tag.at(3) ?? '') ? tag[3] : null;
		if (relayHint !== null) {
			ap.relays = [relayHint];
		}
		const naddr = nip19.naddrEncode(ap);
		const url = getClientURL(naddr);
		const name = tag[1];
		return { name, url };
	});
	const contentWarningReason: string | null = $derived.by(() => {
		const cwTag: string[] | undefined = event.tags.find((tag) => tag[0] === 'content-warning');
		if (cwTag === undefined) {
			return null;
		}
		if (cwTag[1] === undefined) {
			return '';
		}
		return cwTag[1];
	});
	const pubkeysMentioningTo: string[] = $derived(
		event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1])
	);
	const classNames: string[] = $derived.by(() => {
		const classNames: string[] = ['Entry'];
		if (level > 0) {
			classNames.push('Quote');
		}
		if (level > 0 && level % 2 === 0) {
			classNames.push('Even');
		} else if (level % 2 === 1) {
			classNames.push('Odd');
		}
		if (isMutedPubkey) {
			classNames.push('Muted-pubkey');
		}
		if (isMutedChannel) {
			classNames.push('Muted-channel');
		}
		if (isMutedContent) {
			classNames.push('Muted-content');
		}
		if (contentWarningReason !== null) {
			classNames.push('ContentWarning');
		}
		if (loginPubkey !== undefined && pubkeysMentioningTo.includes(loginPubkey)) {
			classNames.push('mentioning');
		}
		return classNames;
	});
	let showCW: boolean = $state(false);
	let showMutedPubkey: boolean = $state(false);
	let showMutedChannel: boolean = $state(false);
	let showMutedContent: boolean = $state(false);

	const prof: ProfileContentEvent | undefined = $derived(profileMap.get(event.pubkey));
	const idReplyTo: string | undefined = $derived.by(() => {
		const getId = (marker: string) =>
			event.tags.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === marker)?.at(1);
		if (event.kind === 1) {
			return getId('reply') ?? getId('root') ?? undefined;
		} else if (event.kind === 42) {
			return getId('reply');
		}
		return undefined;
	});
	const pubkeyReplyTo: string | undefined = $derived(getEventById(idReplyTo ?? '')?.pubkey);
	const profReplyTo: ProfileContentEvent | undefined = $derived(
		pubkeyReplyTo === undefined ? undefined : profileMap.get(pubkeyReplyTo)
	);

	let showForm: boolean = $state(false);

	const repostedEventId: string | undefined = $derived(
		event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1)
	);
	const repostedEvent: NostrEvent | undefined = $derived(getEventById(repostedEventId ?? ''));
</script>

<article class={classNames.join(' ')}>
	{#if (!isMutedPubkey || showMutedPubkey) && (!isMutedChannel || showMutedChannel) && (!isMutedContent || showMutedContent)}
		{#if event.kind === 42 && (channelId === undefined || channel?.id === undefined || channel.name === undefined)}
			kind:42 event of unknown channel
		{:else}
			<div class="Entry__main">
				<div class="Entry__profile">
					<div>
						<a href="/{nip19.npubEncode(event.pubkey)}">
							<img
								src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(event.pubkey))}
								alt={getProfileName(prof)}
								class="Avatar"
							/>
						</a>
					</div>
				</div>
				<div class="Post">
					<div class="Entry__head">
						<h3 class="Entry__keyword">
							{#if event.kind === 42 && channel !== undefined}
								<a href="/keyword/{nip19.neventEncode(channel)}">{channel.name}</a>
								{#if currentChannelId === undefined}
									<span class="post-channel">
										<button
											aria-label="Post to this keyword"
											class="post-chennel"
											disabled={loginPubkey === undefined}
											title="Post to this keyword"
											onclick={() => {
												channelToPost = channel;
												window.scroll({
													top: 0,
													behavior: 'smooth'
												});
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="24"
												height="24"
												viewBox="0 0 24 24"
											>
												<path
													fill-rule="evenodd"
													d="M12,21.2037682 L1.48140774,12 L12,2.79623177 L12,8.02302014 C18.5486628,8.33140969 22,11.7344566 22,18 L22,20.4142136 L20.2928932,18.7071068 C18.0460687,16.4602823 15.3097943,15.5189215 12,15.8718462 L12,21.2037682 Z M10,7.20376823 L4.51859226,12 L10,16.7962318 L10,14.1528729 L10.835601,14.0136061 C14.2501827,13.4445091 17.255572,14.0145027 19.7987459,15.7165365 C19.0504666,11.8510227 16.2006399,10 11,10 L10,10 L10,7.20376823 Z"
												/>
											</svg>
										</button>
									</span>
								{/if}
							{:else if event.kind === 1}
								<a href="/{nip19.npubEncode(event.pubkey)}">id:{prof?.name ?? 'none'}</a>
							{:else if [6, 16].includes(event.kind)}
								<span title={`kind:${event.kind} repost`}>🔁</span>
								{#if event.kind === 6}
									<a href="/{nip19.npubEncode(event.pubkey)}">id:{prof?.name ?? 'none'}</a>
								{:else if event.kind === 16 && event.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1] === '42')}
									{@const channelIdReposted = getRootId(repostedEvent)}
									{@const repostedChannel = channelMap.get(channelIdReposted ?? '')}
									{#if channelIdReposted === undefined}
										{'invalid channel'}
									{:else if repostedChannel !== undefined}
										<a href="/keyword/{nip19.neventEncode(repostedChannel)}"
											>{repostedChannel.name ?? 'unknown'}</a
										>
									{:else}
										<a href="/keyword/{nip19.neventEncode({ id: channelIdReposted })}">unknown</a>
									{/if}
								{/if}
							{:else if event.kind === 7}
								<Reaction reactionEvent={event} profile={undefined} isAuthor={false} />7
							{:else}
								{`unsupported kind:${event.kind} event`}
							{/if}
						</h3>
						<AddStar {event} {loginPubkey} {profileMap} {eventsReactionToTheEvent} />
					</div>
					<div class="Entry__body">
						{#if idReplyTo !== undefined}
							<div class="Entry__parentmarker">
								<a
									href="/entry/{nip19.neventEncode({ id: idReplyTo, author: pubkeyReplyTo })}"
									class=""
								>
									<i class="fa-fw fas fa-arrow-alt-from-right"></i>
									<span class="Mention">
										{#if pubkeyReplyTo !== undefined}
											<img
												src={profReplyTo?.picture ??
													getRoboHashURL(nip19.npubEncode(pubkeyReplyTo))}
												alt={getProfileName(profReplyTo)}
												class="Avatar Avatar--sm"
											/>
											<Content
												content={getProfileName(profReplyTo)}
												tags={profReplyTo?.event.tags ?? []}
												isAbout={true}
											/>
										{/if}
									</span>
								</a>
							</div>
						{/if}
						<div class="Entry__content">
							{#if contentWarningReason === null || showCW}
								{#if [6, 16].includes(event.kind)}
									{#if repostedEvent !== undefined}
										{#if (event.kind === 6 && repostedEvent.kind === 1) || (event.kind === 16 && repostedEvent.kind !== 1)}
											<Entry
												event={repostedEvent}
												{channelMap}
												{profileMap}
												{loginPubkey}
												{mutedPubkeys}
												{mutedChannelIds}
												{mutedWords}
												{eventsTimeline}
												{eventsReaction}
												{uploaderSelected}
												bind:channelToPost
												{currentChannelId}
												{nowRealtime}
												level={level + 1}
											/>
										{:else}
											<p class="warning-message">
												{`⚠️Reposting a kind:${repostedEvent.kind} event is disallowed in kind:${event.kind} repost events.`}
											</p>
										{/if}
									{:else if repostedEventId !== undefined}
										{`nostr:${nip19.neventEncode({ id: repostedEventId })}`}
									{/if}
								{:else if event.kind === 7}
									{@const reactedEventId = event.tags
										.findLast((tag) => tag.length >= 2 && tag[0] === 'e')
										?.at(1)}
									{@const reactedEvent = getEventById(reactedEventId ?? '')}
									{#if reactedEvent !== undefined}
										<Entry
											event={reactedEvent}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{eventsTimeline}
											{eventsReaction}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{nowRealtime}
											level={level + 1}
										/>
									{:else if reactedEventId !== undefined}
										{`nostr:${nip19.neventEncode({ id: reactedEventId })}`}
									{/if}
								{:else}
									<p>
										<Content
											content={event.content}
											tags={event.tags}
											{channelMap}
											{profileMap}
											{loginPubkey}
											{mutedPubkeys}
											{mutedChannelIds}
											{mutedWords}
											{eventsTimeline}
											{eventsReaction}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{nowRealtime}
											{level}
										/>
									</p>
								{/if}
								{#if contentWarningReason !== null}
									<button
										class="Button toggle-cw"
										onclick={() => {
											showCW = false;
										}}><span>click to hide the CW content</span></button
									>
								{/if}
								{#if isMutedPubkey}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedPubkey = false;
										}}><span>click to hide the content by muted account</span></button
									>
								{/if}
								{#if isMutedChannel}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedChannel = false;
										}}><span>click to hide the content by muted channel</span></button
									>
								{/if}
								{#if isMutedContent}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedContent = false;
										}}><span>click to hide the content by muted word</span></button
									>
								{/if}
							{:else}
								<p class="warning-message">
									⚠️Content Warning⚠️
									{#if contentWarningReason.length > 0}{'\n'}(Reason: {contentWarningReason}){/if}
								</p>
								<button
									class="Button toggle-cw"
									onclick={() => {
										showCW = true;
									}}><span>click to show the CW content</span></button
								>
							{/if}
						</div>
					</div>
					<div class="Entry__foot">
						<div class="EntryMeta">
							<span class="User">
								<a href="/{nip19.npubEncode(event.pubkey)}">
									<img
										src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(event.pubkey))}
										alt={getProfileName(prof)}
										class="Avatar"
									/>
									<Content
										content={getProfileName(prof)}
										tags={prof?.event.tags ?? []}
										isAbout={true}
									/>
								</a>
							</span>
							<span class="Separator">·</span>
							<span class="Time">
								<a
									href="/entry/{nip19.neventEncode({
										id: event.id,
										author: event.pubkey,
										kind: event.kind
									})}"
								>
									<time
										datetime={new Date(1000 * event.created_at).toISOString()}
										title={new Date(1000 * event.created_at).toLocaleString()}
										class="NoticeItem__time"
										>{getRelativetime(nowRealtime, 1000 * event.created_at)}</time
									>
								</a>
							</span>
							{#if urlViaAP !== undefined && URL.canParse(urlViaAP)}
								<span class="Separator">·</span>
								<span class="proxy"
									>via <a href={urlViaAP} target="_blank" rel="noopener noreferrer"
										><img src="/ActivityPub-logo-symbol.svg" alt="ActivityPub-logo-symbol" /></a
									></span
								>
							{/if}
							{#if clientInfo !== undefined}
								<span class="Separator">·</span>
								<span class="via"
									>via <a href={clientInfo.url} target="_blank" rel="noopener noreferrer"
										>{clientInfo.name}</a
									></span
								>
							{/if}
							{#if loginPubkey !== undefined}
								{#if loginPubkey === event.pubkey}
									<span class="Separator">·</span>
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span
										class="DeleteButton"
										onclick={() => {
											if (confirm('このエントリーを削除しますか？')) {
												sendDeletion(event);
											}
										}}><i class="far fa-times-circle"></i></span
									>
								{/if}
								<span class="Separator">·</span>
								<span class="repost">
									<button
										aria-label="Repost Button"
										class="repost"
										title="repost"
										onclick={() => {
											sendRepost(event);
										}}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="24"
											height="24"
											viewBox="0 0 24 24"
										>
											<path
												fill-rule="evenodd"
												d="M17.8069373,7 C16.4464601,5.07869636 14.3936238,4 12,4 C7.581722,4 4,7.581722 4,12 L2,12 C2,6.4771525 6.4771525,2 12,2 C14.8042336,2 17.274893,3.18251178 19,5.27034886 L19,2 L21,2 L21,9 L14,9 L14,7 L17.8069373,7 Z M6.19306266,17 C7.55353989,18.9213036 9.60637619,20 12,20 C16.418278,20 20,16.418278 20,12 L22,12 C22,17.5228475 17.5228475,22 12,22 C9.19576641,22 6.72510698,20.8174882 5,18.7296511 L5,22 L3,22 L3,15 L10,15 L10,17 L6.19306266,17 Z"
											/>
										</svg>
									</button>
								</span>
								{#if (profileMap.get(event.pubkey)?.lud16 ?? profileMap.get(event.pubkey)?.lud06) !== undefined}
									<span class="Separator">·</span>
									<span class="zap">
										<button
											aria-label="Zap Button"
											class="zap"
											title="zap"
											onclick={() => {
												const relaysToWrite: string[] = Object.entries(getRelaysToUse())
													.filter((v) => v[1].write)
													.map((v) => v[0]);
												zap(
													nip19.npubEncode(event.pubkey),
													nip19.noteEncode(event.id),
													relaysToWrite
												);
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="24"
												height="24"
												viewBox="0 0 24 24"
											>
												<path
													fill-rule="evenodd"
													d="M9,15 L3.91937515,15 L15,1.14921894 L15,9 L20.0806248,9 L9,22.8507811 L9,15 Z M8.08062485,13 L11,13 L11,17.1492189 L15.9193752,11 L13,11 L13,6.85078106 L8.08062485,13 Z"
												/>
											</svg>
										</button>
									</span>
								{/if}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="Entry__reply"
									onclick={() => {
										showForm = !showForm;
									}}><i class="fal fa-comment-lines"></i> 返信</span
								>
							{/if}
						</div>
					</div>
					<div class="Entry__replyline"></div>
					<div class="Entry__MobileActions"></div>
				</div>
			</div>
			<div class="Extra">
				<div class="Entry__composeReply">
					{#if showForm}
						<CreateEntry
							{loginPubkey}
							eventToReply={event}
							{profileMap}
							{uploaderSelected}
							channelToPost={undefined}
							bind:showForm
						/>
					{/if}
				</div>
			</div>
		{/if}
	{:else}
		<div class="Entry__main muted">
			<div class="Post">
				<div class="Entry__body">
					<div class="Entry__content">
						{#if isMutedPubkey && !showMutedPubkey}
							<p class="muted-message">muted account</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedPubkey = true;
								}}><span>click to show the content by muted account</span></button
							>
						{/if}
						{#if isMutedChannel && !showMutedChannel}
							<p class="muted-message">muted channel</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedChannel = true;
								}}><span>click to show the content in muted channel</span></button
							>
						{/if}
						{#if isMutedContent && !showMutedContent}
							<p class="muted-message">muted word</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedContent = true;
								}}><span>click to show the content by muted word</span></button
							>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</article>

<style>
	.Entry {
		max-height: 50em;
		overflow-y: visible;
	}
	.Entry__head {
		position: relative;
	}
	.Entry__content {
		padding: 3px 1px;
		max-height: 30em;
		overflow-y: auto;
	}
	.Quote.Odd {
		background-color: rgba(255, 127, 127, 0.1);
	}
	.Quote.Even {
		background-color: rgba(127, 127, 255, 0.1);
	}
	.warning-message {
		background-color: rgba(255, 255, 127, 0.1);
	}
	.muted-message {
		background-color: rgba(255, 127, 255, 0.1);
	}
	.mentioning {
		background-color: rgba(255, 255, 0, 0.2);
	}
	.proxy img {
		width: 16px;
		height: 16px;
		vertical-align: top;
	}
	.Post span {
		font-size: 12px;
		margin-right: 3px;
	}
	.Post span > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
		vertical-align: bottom;
	}
	.Post span > button:disabled {
		cursor: not-allowed;
	}
	.Post span > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	.Post span > button:active > svg {
		fill: yellow;
	}
</style>
