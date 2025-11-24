// svelte.config.js
import adapter from '@sveltejs/adapter-static';
// ...

/** @type {import('@sveltejs/kit').Config} */
const config = {
    // ...
    kit: {
        adapter: adapter({
            // Đặt thành 'build' hoặc thư mục bạn muốn Firebase Hosting trỏ tới
            pages: 'build',
            assets: 'build',
            fallback: 'index.html', // Cực kỳ quan trọng cho SPA
            precompress: false
        })
    }
};

export default config;