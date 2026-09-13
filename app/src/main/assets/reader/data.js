/* Parse the live X response into a small reading model. No HTML from the network is executed. */
(function(scope) {
function at(value, path) {
    return path.split('.').reduce(function(v, key) {
        return v && v[key];
    }, value);
}
function https(value) {
    try {
        var u = new URL(value);
        return u.protocol === 'https:' ? u.href : '';
    } catch (_) {
        return '';
    }
}
function profileText(value) {
    return typeof value === 'string' ? value : '';
}
function user(tweet) {
    if (!tweet) return {name: '', handle: '', avatar: ''};
    var u = at(tweet, 'core.user_results.result') || tweet.user || tweet;
    var legacy = u.legacy || (u.screen_name ? u : {});
    var urlEntry = (at(u, 'profile_bio.entities.url.urls') || at(legacy, 'entities.url.urls') || [])[0];
    var userUrl = urlEntry ? (urlEntry.expanded_url || urlEntry.url || '') : (at(u, 'website.url') || legacy.url || '');
    var urlDisplay = urlEntry && urlEntry.display_url ? urlEntry.display_url : (userUrl ? linkText(userUrl) : '');
    return {
        id: u.rest_id || u.id || '',
        name: at(u, 'core.name') || legacy.name || u.name || '',
        handle: at(u, 'core.screen_name') || legacy.screen_name || u.handle || '',
        avatar: https(at(u, 'avatar.image_url') || legacy.profile_image_url_https || u.avatar || ''),
        banner: https(at(u, 'banner.image_url') || legacy.profile_banner_url || profileText(u.banner)),
        bio: decode(profileText(at(u, 'profile_bio.description')) || profileText(legacy.description) || profileText(u.bio)),
        verified: !!(u.is_blue_verified || legacy.verified || u.verified),
        followersCount: count(legacy.followers_count != null ? legacy.followers_count : (at(u, 'relationship_counts.followers') != null ? at(u, 'relationship_counts.followers') : u.followersCount)),
        followingCount: count(legacy.friends_count != null ? legacy.friends_count : (at(u, 'relationship_counts.following') != null ? at(u, 'relationship_counts.following') : u.followingCount)),
        postsCount: count(legacy.statuses_count != null ? legacy.statuses_count : (at(u, 'tweet_counts.tweets') != null ? at(u, 'tweet_counts.tweets') : u.postsCount)),
        location: profileText(legacy.location) || profileText(at(u, 'location.location')) || profileText(u.location),
        url: userUrl,
        urlDisplay: urlDisplay,
        joined: profileText(at(u, 'core.created_at')) || profileText(legacy.created_at) || profileText(u.joined),
        following: typeof at(u, 'relationship_perspectives.following') === 'boolean' ? u.relationship_perspectives.following : typeof legacy.following === 'boolean' ? legacy.following : (typeof u.following === 'boolean' ? u.following : false),
        followedBy: typeof legacy.followed_by === 'boolean' ? legacy.followed_by : (typeof u.followedBy === 'boolean' ? u.followedBy : false)
    };
}
function host(value) {
    try {
        return new URL(value).hostname.replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}
function internal(domain) {
    return /(^|\.)(x\.com|twitter\.com)$/.test(domain);
}
function cardLink(t) {
    var legacy = at(t, 'card.legacy');
    if (!legacy) return null;
    var values = {};
    (legacy.binding_values || []).forEach(function(binding) {
        if (binding && binding.key && typeof at(binding, 'value.string_value') === 'string')
            values[binding.key] = binding.value.string_value;
    });
    return {
        tco: legacy.url || '',
        url: https(values.card_url || ''),
        title: values.title || '',
        domain: (values.domain || values.vanity_url || '').replace(/^www\./, '')
    };
}
/** A count X actually sent. Absent stays absent: a missing field is not a zero. */
/** X sends the body HTML-escaped; decode once so the reader escapes exactly once. */
function decode(value) {
    return String(value == null ? '' : value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}
function count(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return null;
}
function linkText(url) {
    try {
        var u = new URL(url);
        return (u.hostname.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, '');
    } catch (_) {
        return url;
    }
}
/** External reading targets: the publisher page behind each t.co, never a link back into X. */
function links(t, legacy, note) {
    var card = cardLink(t), out = [], seen = {};
    function add(entry, matched) {
        var display = String(entry.display_url || ''), shown = display.split('/')[0].replace(/^www\./, '');
        var target = https(entry.unwound_url || at(entry, 'unwound.url') || entry.expanded_url || '');
        if (matched && matched.url && (!target || host(target) === 't.co')) target = matched.url;
        var reached = host(target);
        var domain = matched && matched.domain || (reached && reached !== 't.co' ? reached : shown);
        if (!domain || internal(domain) || internal(shown) || internal(reached)) return;
        var url = target || https(entry.url || ''), wrapper = entry.url || '';
        // Dedupe on the wrapper too: a card repeats the t.co its body link already resolved.
        if (!url || seen[url] || (wrapper && seen[wrapper])) return;
        seen[url] = true;
        if (wrapper) seen[wrapper] = true;
        out.push({
            url: url,
            title: matched && matched.title || (shown === domain && display ? display : linkText(url)),
            domain: domain
        });
    }
    (at(note, 'entity_set.urls') || at(legacy, 'entities.urls') || []).forEach(function(entry) {
        add(entry, card && card.tco && entry.url === card.tco ? card : null);
    });
    if (card && card.url) add({url: card.tco, display_url: card.domain}, card);
    return out;
}
function tweetLinks(t, legacy, note) {
    var out = [], seen = {};
    function add(entry) {
        if (!entry) return;
        var target = https(entry.unwound_url || at(entry, 'unwound.url') || entry.expanded_url || entry.url || '');
        var display = String(entry.display_url || '');
        var m = (target || display).match(/(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(?:x\.com|twitter\.com)\/(?:([a-zA-Z0-9_]+)\/status|i\/(?:web\/)?status)\/(\d+)/i);
        if (!m) return;
        var handle = (m[1] && m[1] !== 'i' && m[1] !== 'i/web') ? m[1] : '';
        var statusId = m[2];
        if (!statusId || seen[statusId]) return;
        seen[statusId] = true;
        out.push({
            id: statusId,
            handle: handle,
            url: target || ('https://x.com/' + (handle || 'i') + '/status/' + statusId),
            display: display || ('x.com/' + (handle || 'i') + '/status/' + statusId)
        });
    }
    (at(note, 'entity_set.urls') || at(legacy, 'entities.urls') || []).forEach(add);
    var card = cardLink(t);
    if (card && card.url) add(card);
    return out;
}
function tweet(value) {
    if (!value) return null;
    var t = value.tweet || value;
    if (!t.rest_id || !t.legacy) return null;
    var legacy = t.legacy;
    var repost = at(legacy, 'retweeted_status_result.result');
    if (repost) {
        var original = tweet(repost);
        if (original) original.repostedBy = user(t).name;
        return original;
    }
    var note = at(t, 'note_tweet.note_tweet_results.result');
    var article = at(t, 'article.article_results.result');
    var text = note && note.text || legacy.full_text || '';
    if (article) {
        var blocks = at(article, 'content_state.blocks') || [];
        text = (article.title || '') + '\n\n' +
            (blocks.length ? blocks
                                 .map(function(b) {
                                     return b.text || '';
                                 })
                                 .join('\n\n') :
                             article.preview_text || text);
    }
    var media = (at(legacy, 'extended_entities.media') || []).map(function(m) {
        var videos = (at(m, 'video_info.variants') || []).filter(function(v) {
            return v.content_type === 'video/mp4' && https(v.url);
        });
        videos.sort(function(a, b) {
            return (a.bitrate || 0) - (b.bitrate || 0);
        });
        var video = videos.find(function(v) {
            return v.bitrate >= 800000;
        }) ||
            videos[0];
        return {
            type: m.type,
            image: https(m.media_url_https),
            video: video ? https(video.url) : '',
            alt: m.ext_alt_text || '',
            // An animated gif has no length worth showing, so it is not given one.
            duration: m.type === 'video' ? count(at(m, 'video_info.duration_millis')) : null
        };
    });
    if (article && at(article, 'cover_media.media_info.original_img_url'))
        media.unshift({
            type: 'photo',
            image: https(at(article, 'cover_media.media_info.original_img_url')),
            video: '',
            alt: ''
        });
    var author = user(t);
    return {
        id: t.rest_id,
        path: '/' + author.handle + '/status/' + t.rest_id,
        author: author,
        text: decode(text),
        complete: article ? !!at(article, 'content_state.blocks.length') :
                            !!(note && typeof note.text === 'string') || (!t.note_tweet && !legacy.truncated),
        replyTo: legacy.in_reply_to_status_id_str || '',
        conversation: legacy.conversation_id_str || '',
        replies: count(legacy.reply_count),
        likes: count(legacy.favorite_count),
        liked: !!legacy.favorited,
        likeKnown: typeof legacy.favorited === 'boolean',
        views: count(at(t, 'views.count')),
        created: legacy.created_at || '',
        media: media,
        links: links(t, legacy, note),
        tweetLinks: tweetLinks(t, legacy, note),
        quoted: tweet(at(t, 'quoted_status_result.result'))
    };
}
function parse(payload, mode, targetId) {
    var posts = [], seen = new Set(), cursor = '';
    function walk(value) {
        if (!value || typeof value !== 'object') return;
        if (value.cursorType === 'Bottom' && typeof value.value === 'string') cursor = value.value;
        var result = at(value, 'tweet_results.result');
        if (result) {
            var post = tweet(result);
            if (post && !seen.has(post.id)) {
                seen.add(post.id);
                posts.push(post);
            }
            return;
        }
        Object.keys(value).forEach(function(key) {
            walk(value[key]);
        });
    }
    walk(payload.data);
    var authorInfo = null;
    var userResult = at(payload, 'data.user.result');
    if (userResult) {
        authorInfo = user(userResult);
    }
    // Every list — the timeline, the reader's likes, or an author's tweets — is the same shape.
    if (mode !== 'detail') return {posts: posts, cursor: cursor, author: authorInfo};
    var root = posts.find(function(post) {
        return post.id === targetId;
    });
    var index = new Map(posts.map(function(post) {
        return [post.id, post];
    }));
    var comments = posts.filter(function(post) {
        if (post.id === targetId || !post.replyTo) return false;
        var parent = post.replyTo;
        for (var i = 0; i < 20 && parent; i++) {
            if (parent === targetId) return true;
            var ancestor = index.get(parent);
            parent = ancestor && ancestor.replyTo;
        }
        return post.conversation === targetId;
    });
    return {root: root || null, posts: comments, cursor: cursor};
}
scope.TvXReadData = {
    parse: parse,
    user: user
};
})(typeof window === 'undefined' ? globalThis : window);
