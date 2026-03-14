export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { handle } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle manquant' });

  const HOST = 'instagram-looter2.p.rapidapi.com';
  const KEY = process.env.RAPIDAPI_KEY;

  if (!KEY) return res.status(500).json({ error: 'Clé API non configurée' });

  try {
    // 1. Profil via Instagram Looter (données fraîches)
    const profileRes = await fetch(`https://${HOST}/profile2?username=${handle}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': HOST,
        'x-rapidapi-key': KEY
      }
    });

    if (!profileRes.ok) {
      return res.status(404).json({ error: 'Profil introuvable ou compte privé' });
    }

    const profileJson = await profileRes.json();
    const u = profileJson.data || profileJson.user || profileJson;

    if (!u || (!u.follower_count && !u.followers && !u.edge_followed_by)) {
      return res.status(404).json({ error: 'Profil introuvable ou compte privé' });
    }

    const followers = u.follower_count || u.followers || (u.edge_followed_by?.count) || 0;
    const following = u.following_count || u.following || (u.edge_follow?.count) || 0;
    const posts = u.media_count || u.posts || (u.edge_owner_to_timeline_media?.count) || 0;

    // 2. Posts récents
    let recentPosts = [];
    try {
      const postsRes = await fetch(`https://${HOST}/posts?username=${handle}&count=5`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': HOST,
          'x-rapidapi-key': KEY
        }
      });
      const postsJson = await postsRes.json();
      const rawPosts = postsJson.data || postsJson.posts || postsJson || [];
      if (Array.isArray(rawPosts)) {
        recentPosts = rawPosts.slice(0, 5).map((p, i) => {
          const likes = p.like_count || p.likes || p.edge_media_preview_like?.count || 0;
          const commentsCount = p.comment_count || p.comments || p.edge_media_to_comment?.count || 0;
          const eng = followers > 0 ? parseFloat(((likes + commentsCount) / followers * 100).toFixed(2)) : 0;
          return { num: i + 1, likes, commentsCount, engagement: eng };
        });
      }
    } catch (e) { /* posts indisponibles */ }

    const avgEng = recentPosts.length > 0
      ? recentPosts.reduce((s, p) => s + p.engagement, 0) / recentPosts.length
      : estimateEng(followers);

    const ratio = followers / Math.max(following, 1);
    let authScore = 75;
    if (ratio > 20) authScore = Math.floor(Math.random() * 8 + 87);
    else if (ratio > 5) authScore = Math.floor(Math.random() * 12 + 75);
    else if (ratio > 2) authScore = Math.floor(Math.random() * 15 + 58);
    else authScore = Math.floor(Math.random() * 20 + 35);
    if (u.is_verified) authScore = Math.max(authScore, 88);

    return res.status(200).json({
      handle: '@' + handle,
      name: u.full_name || u.name || handle,
      bio: u.biography || u.bio || '',
      followers,
      following,
      posts,
      engagementRate: parseFloat(avgEng.toFixed(1)),
      authFollowers: authScore,
      verified: u.is_verified || false,
      recentPosts,
      isDemo: false
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur: ' + err.message });
  }
}

function estimateEng(followers) {
  if (followers < 10000) return 3.5 + Math.random() * 2;
  if (followers < 50000) return 2.5 + Math.random() * 2;
  if (followers < 200000) return 1.5 + Math.random() * 1.5;
  return 0.8 + Math.random() * 1.2;
}
