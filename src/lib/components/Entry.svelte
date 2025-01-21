<script lang="ts">
	import { getClientURL, getRoboHashURL } from '$lib/config';
	import {
		getAbsoluteTime,
		getRelativeTime,
		zap,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import {
		bookmarkEmojiSets,
		getEventByAddressPointer,
		getEventById,
		getEventsReplying,
		getProfileName,
		getRelaysToUse,
		getSeenOn,
		sendDeletion,
		sendRepost,
		unbookmarkEmojiSets
	} from '$lib/resource.svelte';
	import Reaction from '$lib/components/Reaction.svelte';
	import AddStar from '$lib/components/AddStar.svelte';
	import ChannelMeta from '$lib/components/ChannelMeta.svelte';
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
		mutedHashTags,
		eventsTimeline,
		eventsReaction,
		eventsEmojiSet,
		uploaderSelected,
		channelToPost = $bindable(),
		currentChannelId,
		isEnabledRelativeTime,
		nowRealtime,
		level,
		isNested = false
	}: {
		event: NostrEvent;
		channelMap: Map<string, ChannelContent>;
		profileMap: Map<string, ProfileContentEvent>;
		loginPubkey: string | undefined;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		eventsTimeline: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		uploaderSelected: string;
		channelToPost: ChannelContent | undefined;
		currentChannelId: string | undefined;
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
		level: number;
		isNested?: boolean;
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
		eventsReaction.filter((ev) => {
			const a = ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
			if (a !== undefined) {
				const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
				return a === `${event.kind}:${event.pubkey}:${d}`;
			} else {
				return (
					ev.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'e')
						.at(-1)
						?.at(1) === event.id && !mutedPubkeys.includes(event.pubkey)
				);
			}
		})
	);
	const isMutedPubkey: boolean = $derived(mutedPubkeys.includes(event.pubkey));
	const isMutedChannel: boolean = $derived(mutedChannelIds.includes(channelId ?? ''));
	const isMutedContent: boolean = $derived(
		mutedWords.some((word) => event.content.toLowerCase().includes(word))
	);
	const isMutedHashTag: boolean = $derived(
		mutedHashTags.some(
			(t) =>
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
					.includes(t) ||
				(channel !== undefined && channel.categories.includes(t))
		)
	);
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
		if (isNested) {
			classNames.push('Nested');
		}
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
		if (isMutedHashTag) {
			classNames.push('Muted-hashtag');
		}
		if (contentWarningReason !== null) {
			classNames.push('ContentWarning');
		}
		if (loginPubkey !== undefined && pubkeysMentioningTo.includes(loginPubkey)) {
			classNames.push('mentioning');
		}
		if (nowRealtime / 1000 < event.created_at - 5) {
			classNames.push('future');
		}
		return classNames;
	});
	let showCW: boolean = $state(false);
	let showMutedPubkey: boolean = $state(false);
	let showMutedChannel: boolean = $state(false);
	let showMutedContent: boolean = $state(false);
	let showMutedHashTag: boolean = $state(false);
	let showReplies: boolean = $state(false);

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
	let showJson: boolean = $state(false);

	const repostedEventId: string | undefined = $derived(
		event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1)
	);
	const repostedEvent: NostrEvent | undefined = $derived(getEventById(repostedEventId ?? ''));

	let zapWindowContainer: HTMLElement | undefined = $state();

	type HandlerInformation = {
		name?: string;
		display_name?: string;
		nip05?: string;
		picture?: string;
		banner?: string;
		about?: string;
		lud16?: string;
		website?: string;
	};

	const getHandlerInformation = (content: string): HandlerInformation | null => {
		let obj: HandlerInformation;
		try {
			obj = JSON.parse(content);
		} catch (error) {
			console.warn(error);
			return null;
		}
		return obj;
	};

	const eventsReplying = $derived(getEventsReplying(event.id));
</script>

<article class={classNames.join(' ')}>
	{#if (!isMutedPubkey || showMutedPubkey) && (!isMutedChannel || showMutedChannel) && (!isMutedContent || showMutedContent) && (!isMutedHashTag || showMutedHashTag)}
		{#if event.kind === 42 && (channelId === undefined || channel === undefined || channel.name === undefined)}
			{#if channelId === undefined}
				kind:42 event without valid channel id
			{:else if channel === undefined}
				kind:42 event of unknown channel
			{:else if channel.name === undefined}
				kind:42 event with unnamed channel
			{/if}
		{:else}
			{@const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1)}
			{@const kind = event.kind}
			{@const link =
				[0, 3].includes(kind) || (10000 <= kind && kind < 20000) || (30000 <= kind && kind < 40000)
					? `/entry/${nip19.naddrEncode({ identifier: d ?? '', pubkey: event.pubkey, kind: event.kind })}`
					: `/entry/${nip19.neventEncode({ ...event, author: event.pubkey })}`}
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
								Reaction <Reaction reactionEvent={event} profile={undefined} isAuthor={false} />
							{:else if event.kind === 40}
								Channel
							{:else if event.kind === 10030}
								User emoji list
							{:else if event.kind === 30023}
								Long-form Content
							{:else if event.kind === 30030}
								Emoji set
							{:else if event.kind === 31990}
								Handler information
							{:else}
								{`unsupported kind:${event.kind} event`}
							{/if}
						</h3>
						<AddStar {event} {loginPubkey} {profileMap} {eventsReactionToTheEvent} {mutedWords} />
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
												{mutedHashTags}
												{eventsTimeline}
												{eventsReaction}
												{eventsEmojiSet}
												{uploaderSelected}
												bind:channelToPost
												{currentChannelId}
												{isEnabledRelativeTime}
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
											{mutedHashTags}
											{eventsTimeline}
											{eventsReaction}
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
											{nowRealtime}
											level={level + 1}
										/>
									{:else if reactedEventId !== undefined}
										{`nostr:${nip19.neventEncode({ id: reactedEventId })}`}
									{/if}
								{:else if event.kind === 40}
									{@const channel = channelMap.get(event.id)}
									{#if channel !== undefined}
										<ChannelMeta {channel} />
									{:else}
										unknown channel
									{/if}
								{:else if event.kind === 10030}
									{@const aStrs = event.tags
										.filter((tag) => tag.length >= 2 && tag[0] === 'a')
										.map((tag) => tag[1])}
									{#each new Set<string>(aStrs) as aStr, i (aStr)}
										{#if i > 0}{'\n'}{/if}
										{@const ary = aStr.split(':')}
										{@const data = { identifier: ary[2], pubkey: ary[1], kind: parseInt(ary[0]) }}
										{@const ev = getEventByAddressPointer(data)}
										{#if ev === undefined}
											{`nostr:${nip19.naddrEncode(data)}`}
										{:else}
											<Entry
												event={ev}
												{channelMap}
												{profileMap}
												{loginPubkey}
												{mutedPubkeys}
												{mutedChannelIds}
												{mutedWords}
												{mutedHashTags}
												{eventsTimeline}
												{eventsReaction}
												{eventsEmojiSet}
												{uploaderSelected}
												{channelToPost}
												{currentChannelId}
												{isEnabledRelativeTime}
												{nowRealtime}
												level={level + 1}
												isNested={true}
											/>
										{/if}
									{/each}
								{:else if event.kind === 30030}
									{@const dTagName =
										event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}
									{@const emojiTags = event.tags.filter(
										(tag) =>
											tag.length >= 3 &&
											tag[0] === 'emoji' &&
											/^\w+$/.test(tag[1]) &&
											URL.canParse(tag[2])
									)}
									{@const aTagStrs = eventsEmojiSet.map(
										(ev) =>
											`${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
									)}
									{@const aTagStr = `${event.kind}:${event.pubkey}:${dTagName}`}
									<div class="emoji-set">
										{#if loginPubkey !== undefined}
											<div>
												{#if aTagStrs.includes(aTagStr)}
													<div
														title="お気に入りから削除"
														class="FavoriteButton FavoriteButton--active"
													>
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																unbookmarkEmojiSets(aTagStr);
															}}
														></span>
													</div>
												{:else}
													<div title="お気に入りに追加" class="FavoriteButton">
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<span
															class="fa-fw fas fa-heart"
															onclick={() => {
																const recommendedRelay = getSeenOn(event.id).at(0);
																bookmarkEmojiSets(aTagStr, recommendedRelay);
															}}
														></span>
													</div>
												{/if}
											</div>
										{/if}
										<p>{dTagName}</p>
										{#each emojiTags as emojiTag (emojiTag[1])}
											<img
												class="emoji"
												src={emojiTag[2]}
												alt={`:${emojiTag[1]}:`}
												title={`:${emojiTag[1]}:`}
											/>
										{/each}
									</div>
								{:else if event.kind === 31990}
									{@const obj = getHandlerInformation(event.content)}
									{#if obj === null}
										{event.content}
									{:else}
										{@const name = obj.name ?? obj.display_name ?? 'unknown'}
										<div class="handler-information">
											{#if URL.canParse(obj.banner ?? '')}
												<img src={obj.banner} alt="banner" class="banner" />
											{/if}
											<p>
												{#if URL.canParse(obj.website ?? '')}
													<a href={obj.website} target="_blank" rel="noopener noreferrer">
														{#if URL.canParse(obj.picture ?? '')}
															<!-- svelte-ignore a11y_img_redundant_alt -->
															<img src={obj.picture} alt="picture" class="picture" />
														{/if}
														{name}
													</a>
												{:else}
													{#if URL.canParse(obj.picture ?? '')}
														<!-- svelte-ignore a11y_img_redundant_alt -->
														<img src={obj.picture} alt="picture" class="picture" />
													{/if}
													{name}
												{/if}
											</p>
											<p>{obj.about}</p>
										</div>
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
											{eventsEmojiSet}
											{uploaderSelected}
											bind:channelToPost
											{currentChannelId}
											{isEnabledRelativeTime}
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
								{#if isMutedHashTag}
									<button
										class="Button toggle-mute"
										onclick={() => {
											showMutedHashTag = false;
										}}><span>click to hide the content by muted hashtag</span></button
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
						<dvi class="via">
							{#if urlViaAP !== undefined && URL.canParse(urlViaAP)}
								<span class="proxy"
									>via <a href={urlViaAP} target="_blank" rel="noopener noreferrer"
										><img src="/ActivityPub-logo-symbol.svg" alt="ActivityPub-logo-symbol" /></a
									></span
								>
							{/if}
							{#if clientInfo !== undefined}
								<span class="via"
									>via <a href={clientInfo.url} target="_blank" rel="noopener noreferrer"
										>{clientInfo.name}</a
									></span
								>
							{/if}
						</dvi>
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
								<a href={link}>
									<time
										datetime={new Date(1000 * event.created_at).toISOString()}
										title={new Date(1000 * event.created_at).toLocaleString()}
										class="NoticeItem__time"
										>{isEnabledRelativeTime
											? getRelativeTime(nowRealtime, 1000 * event.created_at)
											: getAbsoluteTime(1000 * event.created_at)}</time
									>
								</a>
							</span>
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
													relaysToWrite,
													zapWindowContainer
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
									<div class="zap-window-container" bind:this={zapWindowContainer}></div>
								{/if}
								<span class="Separator">·</span>
								<span class="show-json">
									<button
										aria-label="Show JSON"
										class="show-json"
										title="Show JSON"
										onclick={() => {
											showJson = !showJson;
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
												d="M5,14 C3.8954305,14 3,13.1045695 3,12 C3,10.8954305 3.8954305,10 5,10 C6.1045695,10 7,10.8954305 7,12 C7,13.1045695 6.1045695,14 5,14 Z M12,14 C10.8954305,14 10,13.1045695 10,12 C10,10.8954305 10.8954305,10 12,10 C13.1045695,10 14,10.8954305 14,12 C14,13.1045695 13.1045695,14 12,14 Z M19,14 C17.8954305,14 17,13.1045695 17,12 C17,10.8954305 17.8954305,10 19,10 C20.1045695,10 21,10.8954305 21,12 C21,13.1045695 20.1045695,14 19,14 Z"
											/>
										</svg>
									</button>
								</span>
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
					<div class="Entry__replyline">
						{#if eventsReplying.length > 0 && !showReplies}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								title="返信を表示"
								class="ReplyAvatars noselect"
								onclick={() => {
									showReplies = true;
								}}
							>
								<span>↳</span>
								{#each eventsReplying as ev (ev.id)}
									{@const prof = profileMap.get(ev.pubkey)}
									<img
										src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(ev.pubkey))}
										alt={getProfileName(prof)}
										class="Avatar"
									/>
								{/each}
							</div>
						{/if}
					</div>
					<div class="Entry__MobileActions">
						<div class="TabList">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								title="返信"
								class="Action Action--reply"
								onclick={() => {
									showForm = !showForm;
								}}
							>
								<i class="fal fa-comment-lines"></i>
							</span>
							{#if eventsReplying.length > 0 && !showReplies}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									title="返信を表示"
									class="Action Action--replies noselect"
									onclick={() => {
										showReplies = true;
									}}
								>
									<i class="far fa-comment-alt-lines"></i>
									{#each eventsReplying as ev (ev.id)}
										{@const prof = profileMap.get(ev.pubkey)}
										{@const picture = URL.canParse(prof?.picture ?? '') ? prof?.picture : undefined}
										{#if picture !== undefined}
											<img alt="" loading="lazy" src={picture} class="Avatar" />
										{/if}
									{/each}
								</span>
							{/if}
						</div>
					</div>
				</div>
			</div>
			<div class="Extra">
				{#if showJson}
					{@const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1)}
					{@const eventIdEncoded =
						d === undefined
							? nip19.neventEncode({ ...event, author: event.pubkey })
							: nip19.naddrEncode({
									identifier: d,
									pubkey: event.pubkey,
									kind: event.kind
								})}
					{@const channel = channelMap.get(event.id)}
					{@const events =
						event.kind === 40 && channel?.eventkind41 !== undefined
							? [channel.eventkind41, event]
							: [event]}
					<aside class="Entry__json">
						{#each events as event, i (event.id)}
							{#if i > 0}<hr />{/if}
							<dl class="details">
								<dt>User ID</dt>
								<dd><code>{nip19.npubEncode(event.pubkey)}</code></dd>
								<dt>Event ID</dt>
								<dd><code>{eventIdEncoded}</code></dd>
								<dt>Event JSON</dt>
								<dd>
									<pre class="json-view"><code>{JSON.stringify(event, undefined, 2)}</code></pre>
								</dd>
								<dt>Relays seen on</dt>
								<dd>
									<ul>
										{#each getSeenOn(event.id) as relay (relay)}
											<li>{relay}</li>
										{/each}
									</ul>
								</dd>
							</dl>
						{/each}
					</aside>
				{/if}
				<div class="Entry__composeReply">
					{#if showForm}
						<CreateEntry
							{loginPubkey}
							currentChannelId={undefined}
							eventToReply={event}
							isTopPage={false}
							{profileMap}
							{uploaderSelected}
							channelToPost={undefined}
							bind:showForm
						/>
					{/if}
				</div>
				<div class="Entry__replies">
					{#if showReplies}
						{#each eventsReplying as ev (ev.id)}
							<Entry
								event={ev}
								{channelMap}
								{profileMap}
								{loginPubkey}
								{mutedPubkeys}
								{mutedChannelIds}
								{mutedWords}
								{mutedHashTags}
								{eventsTimeline}
								{eventsReaction}
								{eventsEmojiSet}
								{uploaderSelected}
								{channelToPost}
								{currentChannelId}
								{isEnabledRelativeTime}
								{nowRealtime}
								level={level + 1}
								isNested={true}
							/>
						{/each}
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
						{#if isMutedHashTag && !showMutedHashTag}
							<p class="muted-message">muted hashtag</p>
							<button
								class="Button toggle-mute"
								onclick={() => {
									showMutedHashTag = true;
								}}><span>click to show the content by muted hashtag</span></button
							>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</article>

<style>
	.Entry__head {
		position: relative;
	}
	.Entry__content {
		padding: 3px 1px;
		max-height: 30em;
		overflow-y: auto;
	}
	.Entry__content > p {
		white-space: pre-wrap;
	}
	.Entry.Quote .Entry__profile img.Avatar {
		width: 36px;
		height: 36px;
		max-width: unset;
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
	.Entry__body {
		position: relative;
	}
	.via {
		position: absolute;
		bottom: -5px;
		right: 0px;
		width: 100%;
		text-align: right;
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
	.Post .FavoriteButton > span {
		font-size: 16px;
		margin-right: unset;
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
	.emoji {
		height: 32px;
		vertical-align: top;
	}
	.handler-information img.banner {
		max-height: 100px;
	}
	.handler-information img.picture {
		max-height: 32px;
	}
	.Entry__json {
		background-color: var(--entry-nested-bg);
		overflow-x: auto;
		max-width: 60em;
		padding: 3px 1em;
		margin-top: 3px;
	}
	.Entry__json dl * {
		font-size: small;
	}
	.Entry__json dl code {
		font-size: x-small;
	}
	.Entry__json dl dd {
		text-indent: 1em;
	}
	.Entry.future {
		display: none;
	}
</style>
