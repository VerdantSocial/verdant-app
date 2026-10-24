document.addEventListener('alpine:init', () => {
  const safeStorage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        // no-op to preserve page function
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        // no-op to preserve page function
      }
    }
  };

  const makeAvatar = (seed, label = 'V') => {
    const value = String(seed || 'verdant').trim() || 'verdant';
    const initials = String(label || value).trim().slice(0, 2).toUpperCase() || 'V';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <rect width="120" height="120" rx="30" fill="#0f1b12"/>
        <circle cx="60" cy="42" r="18" fill="#4ade80" opacity="0.95"/>
        <path d="M31 92c7-17 22-25 29-25s22 8 29 25" fill="#4ade80" opacity="0.9"/>
        <text x="60" y="68" text-anchor="middle" fill="#051008" font-size="25" font-family="Arial, sans-serif" font-weight="700">${initials}</text>
      </svg>
    `;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  };

  const seedLeafs = [
    {
      id: 1,
      username: 'seed_zero',
      displayName: 'System Node',
      content: 'Welcome to Verdant. Start your own thread below.',
      timestamp: 'System Initialization',
      likes: 0,
      replies: []
    }
  ];

  const supabaseConfig = window.VERDANT_SUPABASE || {};
  const supabaseUrl = String(supabaseConfig.url || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(supabaseConfig.anonKey || '').trim();
  const supabaseClient = window.supabase && window.supabase.createClient && supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

  function getCurrentUser() {
    return safeStorage.get('verdant_user', null);
  }

  function setLocalFeed(feed) {
    safeStorage.set('verdant_leafs', Array.isArray(feed) ? feed : seedLeafs);
    return Array.isArray(feed) ? feed : seedLeafs;
  }

  function formatDate(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function normalizeReply(reply) {
    const profile = Array.isArray(reply.profiles) && reply.profiles[0] ? reply.profiles[0] : null;
    return {
      id: reply.id,
      username: profile ? profile.username : reply.username || 'unknown',
      displayName: profile ? (profile.display_name || profile.username) : reply.display_name || 'Unknown',
      content: reply.content || '',
      avatarUrl: profile && profile.avatar_url ? profile.avatar_url : makeAvatar(profile ? (profile.display_name || profile.username) : 'verdant', (profile ? (profile.display_name || profile.username) : 'V').charAt(0).toUpperCase())
    };
  }

  function normalizeLeaf(row, rows) {
    const profile = Array.isArray(row.profiles) && row.profiles[0] ? row.profiles[0] : null;
    const likesCount = Array.isArray(row.leaf_likes) && row.leaf_likes[0] ? Number(row.leaf_likes[0].count || row.leaf_likes[0].likes || 0) : 0;
    const replies = (rows || [])
      .filter((reply) => reply.parent_id === row.id)
      .map((reply) => normalizeReply(reply));

    return {
      id: row.id,
      username: profile ? profile.username : row.username || 'unknown',
      displayName: profile ? (profile.display_name || profile.username) : row.display_name || 'Unknown',
      content: row.content || '',
      timestamp: formatDate(row.created_at),
      likes: likesCount,
      replies,
      authorId: row.author_id,
      avatarUrl: profile && profile.avatar_url ? profile.avatar_url : makeAvatar(profile ? (profile.display_name || profile.username) : 'verdant', (profile ? (profile.display_name || profile.username) : 'V').charAt(0).toUpperCase())
    };
  }

  function serializeUser(data) {
    return {
      id: data?.id || null,
      username: data?.username || data?.displayName || 'verdant_user',
      displayName: data?.displayName || data?.username || 'Verdant User',
      email: data?.email || 'you@example.com',
      bio: data?.bio || '',
      pfpUrl: data?.pfpUrl || data?.avatar_url || makeAvatar(data?.displayName || data?.username || 'verdant', (data?.displayName || data?.username || 'V').charAt(0).toUpperCase())
    };
  }

  Alpine.data('verdantApp', () => ({
    step: getCurrentUser() ? 'feed' : 'signup',
    authMode: 'signup',
    form: {
      username: '',
      email: '',
      password: '',
      bio: '',
      pfpUrl: ''
    },
    errorMessage: '',
    leafText: '',
    replyText: '',
    replyingTo: null,
    characterLimit: 350,
    leafs: safeStorage.get('verdant_leafs', seedLeafs),
    isSubmitting: false,
    hasSupabase: !!supabaseClient,

    get currentUser() {
      return getCurrentUser() || {
        username: 'verdant_user',
        displayName: 'Verdant User',
        email: 'you@example.com',
        bio: '',
        pfpUrl: makeAvatar('verdant_user', 'V')
      };
    },

    get currentUserAvatar() {
      const user = this.currentUser;
      if (!user) return makeAvatar('verdant', 'V');
      const source = user.pfpUrl || user.avatarUrl || user.image || '';
      return source || makeAvatar(user.displayName || user.username || 'verdant', (user.displayName || user.username || 'V').charAt(0).toUpperCase());
    },

    get profilePreviewUrl() {
      const value = (this.form.pfpUrl || '').trim();
      if (value) return value;
      return makeAvatar(this.form.username || 'verdant', (this.form.username || 'V').charAt(0).toUpperCase());
    },

    setAuthMode(mode) {
      this.authMode = mode;
      this.errorMessage = '';
    },

    async hydrateUserFromSession(sessionUser) {
      if (!sessionUser) {
        this.step = 'signup';
        return;
      }

      let userProfile = null;
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', sessionUser.id)
          .maybeSingle();

        if (!error) userProfile = data;
      }

      const mapped = serializeUser({
        id: sessionUser.id,
        username: userProfile?.username || sessionUser.user_metadata?.username || (sessionUser.email || 'verdant_user').split('@')[0],
        displayName: userProfile?.display_name || sessionUser.user_metadata?.display_name || (userProfile?.username || (sessionUser.email || 'Verdant User').split('@')[0]),
        email: userProfile?.email || sessionUser.email || 'you@example.com',
        bio: userProfile?.bio || '',
        pfpUrl: userProfile?.avatar_url || makeAvatar(userProfile?.display_name || userProfile?.username || sessionUser.email || 'verdant', (userProfile?.display_name || userProfile?.username || 'V').charAt(0).toUpperCase())
      });

      safeStorage.set('verdant_user', mapped);
      this.form.username = mapped.username;
      this.form.email = mapped.email;
      this.form.bio = mapped.bio;
      this.form.pfpUrl = mapped.pfpUrl;
      this.step = 'feed';
      await this.syncFeed();
    },

    async syncFeed() {
      if (!supabaseClient) {
        this.leafs = safeStorage.get('verdant_leafs', seedLeafs);
        return;
      }

      try {
        const { data: rows, error } = await supabaseClient
          .from('leafs')
          .select(`
            id,
            author_id,
            content,
            created_at,
            parent_id,
            profiles:author_id (username, display_name, avatar_url),
            leaf_likes(count)
          `)
          .is('deleted_at', null)
          .eq('hidden_by_staff', false)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const mapped = (rows || [])
          .filter((row) => row.parent_id === null || row.parent_id === undefined)
          .map((row) => normalizeLeaf(row, rows || []));

        this.leafs = mapped.length ? mapped : seedLeafs;
        setLocalFeed(this.leafs);
      } catch (err) {
        console.error('Feed sync failed', err);
        this.leafs = safeStorage.get('verdant_leafs', seedLeafs);
      }
    },

    async createAccount() {
      const username = String(this.form.username || '').trim();
      const email = String(this.form.email || '').trim();
      const password = String(this.form.password || '').trim();

      if (!username || !email || !password) {
        this.errorMessage = 'Please fill in a username, email and password.';
        return;
      }

      if (password.length < 4) {
        this.errorMessage = 'Password must be at least 4 characters.';
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this.errorMessage = 'Please enter a valid email address.';
        return;
      }

      if (!supabaseClient) {
        this.errorMessage = 'Supabase is not configured. Add window.VERDANT_SUPABASE before the app script.';
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        if (this.authMode === 'login') {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (data?.user) {
            await this.hydrateUserFromSession(data.user);
          }
          return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              username,
              display_name: username
            }
          }
        });

        if (error) throw error;

        if (data?.user) {
          const profilePayload = {
            id: data.user.id,
            email,
            username,
            display_name: username,
            bio: String(this.form.bio || '').trim(),
            avatar_url: (String(this.form.pfpUrl || '').trim()) || makeAvatar(username, username.charAt(0).toUpperCase())
          };

          const { error: profileError } = await supabaseClient
            .from('profiles')
            .upsert(profilePayload, { onConflict: 'id' });

          if (profileError) {
            console.warn('Profile upsert issue:', profileError);
          }

          if (data.session) {
            await this.hydrateUserFromSession(data.user);
            return;
          }

          this.errorMessage = 'Check your inbox to confirm the account before you can sign in.';
          this.step = 'signup';
        }
      } catch (error) {
        console.error('Auth failed', error);
        this.errorMessage = error?.message || 'Could not complete that request.';
      } finally {
        this.isSubmitting = false;
      }
    },

    async finishProfile() {
      if (!supabaseClient) {
        this.errorMessage = 'Supabase is not configured.';
        return;
      }

      const user = getCurrentUser();
      if (!user) {
        this.errorMessage = 'You need to be signed in before saving a profile.';
        return;
      }

      const username = String(this.form.username || '').trim();
      const email = String(this.form.email || '').trim();
      const password = String(this.form.password || '').trim();

      if (!username || !email || !password) {
        this.errorMessage = 'Your account is missing required details.';
        return;
      }

      try {
        const { data: { user: sessionUser }, error: userError } = await supabaseClient.auth.getUser();
        if (userError || !sessionUser) {
          this.errorMessage = 'Your session is no longer active.';
          return;
        }

        const profilePayload = {
          id: sessionUser.id,
          email,
          username,
          display_name: username,
          bio: String(this.form.bio || '').trim(),
          avatar_url: (String(this.form.pfpUrl || '').trim()) || makeAvatar(username, username.charAt(0).toUpperCase())
        };

        const { error } = await supabaseClient.from('profiles').upsert(profilePayload, { onConflict: 'id' });
        if (error) throw error;

        const nextUser = serializeUser({
          id: sessionUser.id,
          username,
          displayName: username,
          email,
          bio: profilePayload.bio,
          pfpUrl: profilePayload.avatar_url
        });

        safeStorage.set('verdant_user', nextUser);
        this.errorMessage = '';
        this.step = 'feed';
        await this.syncFeed();
      } catch (error) {
        console.error('Profile failed', error);
        this.errorMessage = error?.message || 'Profile update failed.';
      }
    },

    startNewAccount() {
      safeStorage.remove('verdant_user');
      this.form = {
        username: '',
        email: '',
        password: '',
        bio: '',
        pfpUrl: ''
      };
      this.errorMessage = '';
      this.authMode = 'signup';
      this.step = 'signup';
    },

    async logoutUser() {
      if (supabaseClient) {
        await supabaseClient.auth.signOut();
      }
      safeStorage.remove('verdant_user');
      this.step = 'signup';
      this.form = {
        username: '',
        email: '',
        password: '',
        bio: '',
        pfpUrl: ''
      };
      this.errorMessage = '';
      this.authMode = 'signup';
    },

    async publishLeaf() {
      const current = this.currentUser;
      if (!current) return;

      const text = this.leafText.trim();
      if (!text || text.length > this.characterLimit) return;

      if (supabaseClient) {
        try {
          const { data: { user }, error: userErr } = await supabaseClient.auth.getUser();
          if (userErr || !user) {
            this.errorMessage = 'You must be signed in to post.';
            return;
          }

          const { error } = await supabaseClient.from('leafs').insert([{ author_id: user.id, content: text, hidden_by_staff: false }]);
          if (error) throw error;
          this.leafText = '';
          this.errorMessage = '';
          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Leaf post failed', error);
          this.errorMessage = error?.message || 'Post failed.';
          return;
        }
      }

      const newLeaf = {
        id: Date.now(),
        username: current.username,
        displayName: current.displayName || current.username,
        content: text,
        timestamp: 'Just now',
        likes: 0,
        replies: []
      };

      this.leafs = [newLeaf, ...this.leafs];
      setLocalFeed(this.leafs);
      this.leafText = '';
    },

    async toggleLike(leafId) {
      if (supabaseClient) {
        try {
          const { data: { user }, error } = await supabaseClient.auth.getUser();
          if (error || !user) {
            this.errorMessage = 'Sign in to like a leaf.';
            return;
          }

          const { error: insertError } = await supabaseClient.from('leaf_likes').insert([{ leaf_id: leafId, user_id: user.id }]);
          if (insertError && !String(insertError.message).toLowerCase().includes('duplicate')) {
            throw insertError;
          }
          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Like failed', error);
          this.errorMessage = error?.message || 'Could not save the like.';
          return;
        }
      }

      this.leafs = this.leafs.map((leaf) => {
        if (leaf.id === leafId) {
          return { ...leaf, likes: (leaf.likes || 0) + 1 };
        }
        return leaf;
      });
      setLocalFeed(this.leafs);
    },

    async publishReply(leafId) {
      const text = this.replyText.trim();
      if (!text) return;

      if (supabaseClient) {
        try {
          const { data: { user }, error } = await supabaseClient.auth.getUser();
          if (error || !user) {
            this.errorMessage = 'Sign in to reply.';
            return;
          }

          const { error: insertError } = await supabaseClient.from('leafs').insert([
            {
              author_id: user.id,
              parent_id: leafId,
              content: text,
              hidden_by_staff: false
            }
          ]);

          if (insertError) throw insertError;
          this.replyText = '';
          this.replyingTo = null;
          this.errorMessage = '';
          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Reply failed', error);
          this.errorMessage = error?.message || 'Could not send that reply.';
          return;
        }
      }

      this.leafs = this.leafs.map((leaf) => {
        if (leaf.id !== leafId) return leaf;

        return {
          ...leaf,
          replies: [
            ...(leaf.replies || []),
            {
              id: Date.now(),
              username: this.currentUser.username,
              displayName: this.currentUser.displayName || this.currentUser.username,
              content: text
            }
          ]
        };
      });

      setLocalFeed(this.leafs);
      this.replyText = '';
      this.replyingTo = null;
    }
  }));

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await Alpine.store('verdantApp')?.hydrateUserFromSession?.(session.user);
      }

      if (event === 'SIGNED_OUT') {
        safeStorage.remove('verdant_user');
      }
    });

    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const app = Alpine.store('verdantApp');
        if (app && typeof app.hydrateUserFromSession === 'function') {
          app.hydrateUserFromSession(session.user);
        }
      }
    }).catch((error) => {
      console.warn('Session restore failed', error);
    });
  }
});
