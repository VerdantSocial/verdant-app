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

  function getCurrentUser() {
    return safeStorage.get('verdant_user', null);
  }

  Alpine.data('verdantApp', () => ({
    step: getCurrentUser() ? 'feed' : 'signup',
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

    createAccount() {
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

      this.errorMessage = '';
      this.step = 'profile';
    },

    finishProfile() {
      const username = String(this.form.username || '').trim();
      const email = String(this.form.email || '').trim();
      const password = String(this.form.password || '').trim();

      if (!username || !email || !password) {
        this.errorMessage = 'Your account is missing required details.';
        return;
      }

      const user = {
        username,
        email,
        password,
        bio: String(this.form.bio || '').trim(),
        pfpUrl: (String(this.form.pfpUrl || '').trim()) || makeAvatar(username, username.charAt(0).toUpperCase()),
        displayName: username
      };

      safeStorage.set('verdant_user', user);
      this.errorMessage = '';
      this.step = 'feed';
    },

    logoutUser() {
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
    },

    publishLeaf() {
      if (!this.currentUser) return;

      const text = this.leafText.trim();
      if (!text || text.length > this.characterLimit) return;

      const newLeaf = {
        id: Date.now(),
        username: this.currentUser.username,
        displayName: this.currentUser.displayName || this.currentUser.username,
        content: text,
        timestamp: 'Just now',
        likes: 0,
        replies: []
      };

      this.leafs = [newLeaf, ...this.leafs];
      safeStorage.set('verdant_leafs', this.leafs);
      this.leafText = '';
    },

    toggleLike(leafId) {
      this.leafs = this.leafs.map((leaf) => {
        if (leaf.id === leafId) {
          return { ...leaf, likes: (leaf.likes || 0) + 1 };
        }
        return leaf;
      });
      safeStorage.set('verdant_leafs', this.leafs);
    },

    publishReply(leafId) {
      const text = this.replyText.trim();
      if (!text) return;

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

      safeStorage.set('verdant_leafs', this.leafs);
      this.replyText = '';
      this.replyingTo = null;
    }
  }));
});
