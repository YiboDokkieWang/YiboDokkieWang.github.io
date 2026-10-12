let siteLanguage = localStorage.getItem('site-language') === 'zh' ? 'zh' : 'en'
const config_file = 'config.yml'
const section_names = ['home', 'experience', 'projects', 'awards', 'technologies', 'publications', 'contact']
const languageLoaders = []

const interfaceText = {
    en: {
        'nav-home': 'HOME',
        'nav-researches': 'RESEARCHES',
        'nav-publications': 'PUBLICATIONS',
        'nav-contact': 'CONTACT',
        'toggle-dark': 'Toggle Dark Mode',
        'section-experience': 'WORK/INTERNSHIP EXPERIENCE',
        'section-projects': 'PROJECTS',
        'section-awards': 'AWARDS',
        'section-technologies': 'TECHNOLOGIES',
        'page-researches': 'RESEARCHES',
        'page-publications': 'PUBLICATIONS',
        'page-contact': 'CONTACT',
    },
    zh: {
        'nav-home': '主页',
        'nav-researches': '研究',
        'nav-publications': '发表成果',
        'nav-contact': '联系方式',
        'toggle-dark': '切换深色模式',
        'section-experience': '工作与实习经历',
        'section-projects': '项目',
        'section-awards': '荣誉与奖励',
        'section-technologies': '技术与工具',
        'page-researches': '研究',
        'page-publications': '发表成果',
        'page-contact': '联系方式',
    },
}

window.registerLanguageLoader = loader => languageLoaders.push(loader)

function contentDirectory(language) {
    return language === 'zh' ? 'contents/zh/' : 'contents/'
}

function applyInterfaceText(language) {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const translatedText = interfaceText[language][element.dataset.i18n]
        if (translatedText) element.textContent = translatedText
    })

    const languageButton = document.getElementById('btn-toggle-language')
    if (languageButton) {
        languageButton.textContent = language === 'zh' ? 'English' : '中文'
        languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文')
    }
}

async function loadConfig(language) {
    const response = await fetch(contentDirectory(language) + config_file)
    if (!response.ok) throw new Error(`Unable to load ${config_file}`)
    const yml = jsyaml.load(await response.text())

    Object.keys(yml).forEach(key => {
        const target = document.getElementById(key)
        if (target) target.innerHTML = yml[key]
    })
}

async function loadSections(language) {
    const directory = contentDirectory(language)
    const renderedSections = await Promise.all(section_names.map(async name => {
        const response = await fetch(directory + name + '.md')
        if (!response.ok) throw new Error(`Unable to load ${name}.md`)
        return [name, marked.parse(await response.text())]
    }))

    renderedSections.forEach(([name, html]) => {
        const target = document.getElementById(name + '-md')
        if (target) {
            target.innerHTML = html
            if (name === 'publications') {
                target.querySelectorAll('strong').forEach(author => author.classList.add('author-self'))
            }
        }
    })
}

async function applyLanguage(language, preserveScroll = false) {
    const scrollPosition = window.scrollY
    const languageButton = document.getElementById('btn-toggle-language')
    if (languageButton) languageButton.disabled = true

    try {
        await Promise.all([
            loadConfig(language),
            loadSections(language),
            ...languageLoaders.map(loader => loader(language)),
        ])
        siteLanguage = language
        localStorage.setItem('site-language', language)
        applyInterfaceText(language)
        if (window.MathJax?.typesetPromise) await MathJax.typesetPromise()
        else if (window.MathJax?.typeset) MathJax.typeset()
    } catch (error) {
        console.error(error)
    } finally {
        if (languageButton) languageButton.disabled = false
        if (preserveScroll) window.scrollTo({ top: scrollPosition, left: 0, behavior: 'instant' })
        document.documentElement.classList.remove('language-loading')
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    marked.use({ mangle: false, headerIds: false })
    applyInterfaceText(siteLanguage)

    const languageButton = document.getElementById('btn-toggle-language')
    languageButton && languageButton.addEventListener('click', async event => {
        event.preventDefault()
        const nextLanguage = siteLanguage === 'zh' ? 'en' : 'zh'
        await applyLanguage(nextLanguage, true)
    })

    const mainNav = document.body.querySelector('#mainNav')
    if (mainNav) {
        new bootstrap.ScrollSpy(document.body, {
            target: '#mainNav',
            offset: 74,
        })
    }

    const navbarToggler = document.body.querySelector('.navbar-toggler')
    const responsiveNavItems = [].slice.call(document.querySelectorAll('#navbarResponsive .nav-link'))
    responsiveNavItems.forEach(responsiveNavItem => {
        if (responsiveNavItem.id === 'btn-toggle-language') return
        responsiveNavItem.addEventListener('click', () => {
            if (navbarToggler && window.getComputedStyle(navbarToggler).display !== 'none') {
                navbarToggler.click()
            }
        })
    })

    await applyLanguage(siteLanguage)

    const darkModeButton = document.getElementById('btn-toggle-dark')
    darkModeButton && darkModeButton.addEventListener('click', () => {
        document.documentElement.classList.add('theme-transitioning')
        const darkModeActive = document.documentElement.classList.toggle('darkmode--activated')
        localStorage.setItem('site-theme', darkModeActive ? 'dark' : 'light')
        window.setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 900)
    })
})
