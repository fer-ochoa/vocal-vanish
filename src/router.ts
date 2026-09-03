import { createRouter, createWebHashHistory } from 'vue-router';
import SearchView from './views/SearchView.vue';
import CatalogView from './views/CatalogView.vue';
import PlayerView from './views/PlayerView.vue';
import ConfigView from './views/ConfigView.vue';

// Hash history works cleanly with Electron's file:// loading and avoids any
// server-side routing concerns.
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'search', component: SearchView },
    { path: '/catalog', name: 'catalog', component: CatalogView },
    { path: '/player/:kid', name: 'player', component: PlayerView, props: true },
    { path: '/config', name: 'config', component: ConfigView },
  ],
});
