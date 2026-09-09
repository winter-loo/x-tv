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
function user(tweet) {
    var u = at(tweet, 'core.user_results.result') || {};
    return {
        name: at(u, 'core.name') || at(u, 'legacy.name') || '',
        handle: at(u, 'core.screen_name') || at(u, 'legacy.screen_name') || '',
        avatar: https(at(u, 'avatar.image_url') || at(u, 'legacy.profile_image_url_https') || '')
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
        var url = target || https(entry.url || '');
        if (!url || seen[url]) return;
        seen[url] = true;
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
            alt: m.ext_alt_text || ''
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
        text: text,
        complete: article ? !!at(article, 'content_state.blocks.length') :
                            !!(note && typeof note.text === 'string') || (!t.note_tweet && !legacy.truncated),
        replyTo: legacy.in_reply_to_status_id_str || '',
        conversation: legacy.conversation_id_str || '',
        replies: legacy.reply_count || 0,
        likes: legacy.favorite_count || 0,
        liked: !!legacy.favorited,
        views: at(t, 'views.count') || '',
        created: legacy.created_at || '',
        media: media,
        links: links(t, legacy, note),
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
    if (mode === 'home') return {posts: posts, cursor: cursor};
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
    parse: parse
};
})(typeof window === 'undefined' ? globalThis : window);
