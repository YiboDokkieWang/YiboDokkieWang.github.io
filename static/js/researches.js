

const research_content_dir = 'contents/researches/'
const research_section_names = ['1', '2', '3']


window.addEventListener('DOMContentLoaded', event => {
    // Marked
    marked.use({ mangle: false, headerIds: false })
    const title = document.getElementById('research-title');
    research_section_names.forEach((name, idx) => {
        fetch(research_content_dir + name + '.md')
            .then(response => response.text())
            .then(markdown => {
                const html = marked.parse(markdown);
                const section = document.createElement('section');
                section.className = 'bg-gradient-primary-to-secondary markdown'
                const  div = document.createElement('div')
                div.className = 'container px-5'
                const mdContainer = document.createElement('div')
                mdContainer.classList.add('main-body')
                mdContainer.innerHTML = html
                div.appendChild(mdContainer)
                section.appendChild(div)
                console.log('[section]', section)
                title.after(section)
            }).then(() => {
            // MathJax
            MathJax.typeset();
        })
            .catch(error => console.log(error));
    })
});
