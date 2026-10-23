document.addEventListener('alpine:init', () => {
  const safeStorage = {
    get(key, fallback = []) {
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
        // no-op to keep the page alive
      }
    }
  };

  const seedLeafs = [
    {
      id: 1,
      username: 'seed_zero',
      displayName: 'System Node',
      content: 'Welcome to your secure terminal session on Verdant. Turn your first Leaf below!',
      timestamp: 'System Initialization',
      likes: 0,
      replies: []
    }
  ];

  Alpine.data('verdantFeed', () => ({
    leafText: '',
    replyText: '',
    replyToId: null,
    replyingTo: null,
    characterLimit: 350,
    leafs: safeStorage.get('verdant_leafs', seedLeafs),

    get currentLeafs() {
      return this.leafs;
    },

    publishLeaf() {
      const text = this.leafText.trim();
      if (!text || text.length > this.characterLimit) return;

      const newLeaf = {
        id: Date.now(),
        username: 'verdant_user',
        displayName: 'Verdant User',
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
        if (leaf.id === leafId) {
          const reply = {
            id: Date.now(),
            username: 'verdant_user',
            displayName: 'Verdant User',
            content: text
          };

          return {
            ...leaf,
            replies: [...(leaf.replies || []), reply]
          };
        }
        return leaf;
      });

      safeStorage.set('verdant_leafs', this.leafs);
      this.replyText = '';
      this.replyingTo = null;
    }
  }));
});
