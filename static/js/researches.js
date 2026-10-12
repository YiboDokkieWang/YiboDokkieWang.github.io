const research_section_names = ['1', '2', '3']

async function renderResearchSections(language) {
    const title = document.getElementById('research-title')
    if (!title) return

    let insertionPoint = title
    research_section_names.forEach(name => {
        let section = document.getElementById(name + '-md')
        if (!section) {
            section = document.createElement('section')
            section.id = name + '-md'
            insertionPoint.after(section)
        }
        insertionPoint = section
    })

    const directory = language === 'zh' ? 'contents/zh/researches/' : 'contents/researches/'
    const renderedSections = await Promise.all(research_section_names.map(async name => {
        const response = await fetch(directory + name + '.md')
        if (!response.ok) throw new Error(`Unable to load research ${name}.md`)
        return [name, marked.parse(await response.text())]
    }))

    renderedSections.forEach(([name, html]) => {
        const section = document.getElementById(name + '-md')
        section.innerHTML = ''
        const container = document.createElement('div')
        container.className = 'container px-5'
        const markdownContainer = document.createElement('div')
        markdownContainer.className = 'main-body'
        markdownContainer.innerHTML = html
        container.appendChild(markdownContainer)
        section.appendChild(container)
    })
}

window.registerLanguageLoader(renderResearchSections)
