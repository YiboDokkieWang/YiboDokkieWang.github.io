

const research_content_dir = 'contents/researches/'
const research_section_names = ['1', '2', '3']


window.addEventListener('DOMContentLoaded', async (event) => {
    // Marked
    marked.use({ mangle: false, headerIds: false })
    const title = document.getElementById('research-title');
    for (const section of research_section_names.reverse()) {
        const placeholder = document.createElement('section');
        placeholder.id = section + '-md';
        title.after(placeholder)
    }
    research_section_names.forEach((name, idx) => {
        fetch(research_content_dir + name + '.md')
            .then(response => response.text())
            .then(markdown => {
                const html = marked.parse(markdown);
                const section = document.getElementById(name + '-md');
                const  div = document.createElement('div')
                div.className = 'container px-5'
                const mdContainer = document.createElement('div')
                mdContainer.classList.add('main-body')
                mdContainer.innerHTML = html
                div.appendChild(mdContainer)
                section.appendChild(div)
            }).then(() => {
            // MathJax
            MathJax.typeset();
        })
            .catch(error => console.log(error));
    })
});
