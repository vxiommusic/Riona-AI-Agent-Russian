
import { Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import UserAgent from "user-agents";
import { Server } from "proxy-chain";
import { IGpassword, IGusername } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        // Optionally enable Cooperative Mode for several request interceptors
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);


async function runInstagram() {
    // Create a local proxy server
    const server = new Server({ port: 8000 });
    await server.listen();
    const checkMode = process.env.NODE_ENV === "production" ? true : false;
    const proxyUrl = `http://localhost:8000`;
    const browser: Browser = await puppeteer.launch({
        headless: checkMode,
        args: [`--proxy-server=${proxyUrl}`], // Use the proxy server
    });

    // Check if cookies exist and load them into the page
    if (await Instagram_cookiesExist()) {
        logger.info("Loading cookies...:🚧");
        const cookies = await loadCookies("./cookies/Instagramcookies.json");
        await browser.setCookie(...cookies);
    }
    const page = await browser.newPage();
    // await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

    // Set a random PC user-agent
    const userAgent = new UserAgent({ deviceCategory: "desktop" });
    const randomUserAgent = userAgent.toString();
    logger.info(`Using user-agent: ${randomUserAgent}`);
    await page.setUserAgent(randomUserAgent);

    // Check if cookies
    if (await Instagram_cookiesExist()) {
        logger.info("Cookies loaded, skipping login...");
        await page.goto("https://www.instagram.com", { waitUntil: "networkidle2" });

        // Check if login was successful by verifying page content (e.g., user profile or feed)
        const isLoggedIn = await page.$("a[href='/direct/inbox/']");
        if (isLoggedIn) {
            logger.info("Login verified with cookies.");
        } else {
            logger.warn("Cookies invalid or expired. Logging in again...");
            await loginWithCredentials(page, browser);
        }
    } else {
        // If no cookies are available, perform login with credentials
        await loginWithCredentials(page, browser);
    }

    // Optionally take a screenshot after loading the page
    await page.screenshot({ path: "logged_in.png" });

    // Navigate to the Instagram homepage
    await page.goto("https://www.instagram.com/");

    // Interact with the first post
    await interactWithPosts(page);

    // Close the browser
    await browser.close();
    await server.close(true); // Stop the proxy server and close connections
}




const loginWithCredentials = async (page: any, browser: Browser) => {
    try {
        await page.goto("https://www.instagram.com/accounts/login/");
        await page.waitForSelector('input[name="username"]');

        // Fill out the login form
        await page.type('input[name="username"]', IGusername); // Replace with your username
        await page.type('input[name="password"]', IGpassword); // Replace with your password
        await page.click('button[type="submit"]');

        // Wait for navigation after login
        await page.waitForNavigation();

        // Save cookies after login
        const cookies = await browser.cookies();
        await saveCookies("./cookies/Instagramcookies.json", cookies);
    } catch (error) {
        logger.error("Error logging in with credentials:", error);
    }
}

async function interactWithPosts(page: any) {
    let postIndex = 1; // Start with the first post
    const maxPosts = 50; // Limit to prevent infinite scrolling

    while (postIndex <= maxPosts) {
        try {
            const postSelector = `article:nth-of-type(${postIndex})`;

            // Check if the post exists
            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Exiting loop...");
                break;
            }

            // Добавляем случайную паузу перед взаимодействием с постом (800-1500 мс)
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 700) + 800));
            
            console.log(`Поиск кнопки лайка для поста ${postIndex}...`);
            
            // Используем несколько селекторов для поиска кнопки лайка (повышаем надежность)
            const likeButtonSelectors = [
                `${postSelector} svg[aria-label="Like"]`,
                `${postSelector} svg[aria-label="Нравится"]`,
                `${postSelector} button[type="button"] svg`,
                `${postSelector} span[role="button"] svg`,
                `${postSelector} div[role="button"] svg`,
                `${postSelector} div.x9f619 div.xnz67gz div[role="button"]`
            ];
            
            let likeButton = null;
            let ariaLabel = null;
            
            // Перебираем все селекторы, пока не найдем нужную кнопку
            for (const selector of likeButtonSelectors) {
                try {
                    likeButton = await page.$(selector);
                    if (likeButton) {
                        // Проверяем атрибут aria-label для определения статуса кнопки
                        ariaLabel = await likeButton.evaluate((el: Element) => el.getAttribute("aria-label"));
                        
                        if (ariaLabel === "Like" || ariaLabel === "Нравится" || !ariaLabel) {
                            console.log(`Найдена кнопка лайка с селектором: ${selector}`);
                            break;
                        }
                    }
                } catch (error: unknown) {
                    console.log(`Ошибка при поиске с селектором ${selector}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            
            // Если не удалось найти кнопку с помощью обычных селекторов,
            // используем JavaScript для поиска и клика по кнопке
            if (!likeButton) {
                console.log(`Используем альтернативные методы для поиска и нажатия кнопки лайка...`);
                
                // Метод 1: Попытка использовать page.click() напрямую с более специфичными селекторами
                const specificSelectors = [
                    `${postSelector} article div:nth-child(1) section:nth-child(1) span:nth-child(1) button`,
                    `${postSelector} section span button`, // Часто встречается в Instagram
                    `${postSelector} section span:first-child button`, // Первая кнопка в секции обычно лайк
                    `${postSelector} section:last-child span:first-child button`,
                    `${postSelector} div[role="button"]:has(svg)` // Новый селектор для поиска кнопок с SVG внутри
                ];
                
                for (const selector of specificSelectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            // Случайная задержка перед кликом (400-900 мс)
                            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500) + 400));
                            
                            // Используем метод mousedown/mouseup вместо простого клика - более надежно в Instagram
                            await element.evaluate((el: HTMLElement) => {
                                // Добавляем небольшую случайность в позиции клика
                                const rect = el.getBoundingClientRect();
                                const x = rect.left + rect.width * (0.5 + (Math.random() * 0.3 - 0.15)); // Случайное отклонение от центра на ±15%
                                const y = rect.top + rect.height * (0.5 + (Math.random() * 0.3 - 0.15));

                                // Создаем mousedown событие
                                const mousedownEvent = new MouseEvent('mousedown', {
                                    bubbles: true,
                                    cancelable: true,
                                    view: window,
                                    clientX: x,
                                    clientY: y
                                });
                                el.dispatchEvent(mousedownEvent);

                                // Небольшая задержка между нажатием и отпусканием (10-80 мс)
                                setTimeout(() => {
                                    // Создаем mouseup событие
                                    const mouseupEvent = new MouseEvent('mouseup', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        clientX: x,
                                        clientY: y
                                    });
                                    el.dispatchEvent(mouseupEvent);
                                    
                                    // И, наконец, событие клика
                                    const clickEvent = new MouseEvent('click', {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        clientX: x,
                                        clientY: y
                                    });
                                    el.dispatchEvent(clickEvent);
                                }, Math.floor(Math.random() * 70) + 10);
                            });
                            
                            console.log(`Пост ${postIndex} лайкнут с помощью реалистичного клика по селектору: ${selector}`);
                            return; // Выходим из цикла, если успешно нашли и нажали на кнопку
                        }
                    } catch (error: unknown) {
                        console.log(`Ошибка при попытке клика по селектору ${selector}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                
                // Метод 2: Если первый метод не удался, используем поиск через JavaScript
                const likeButtonFound = await page.evaluate((postSel: string) => {
                    try {
                        // Находим сам пост
                        const article = document.querySelector(postSel);
                        if (!article) return { success: false, reason: 'post_not_found' };
                        
                        // Находим все SVG иконки и кнопки в посте
                        const svgElements = Array.from(article.querySelectorAll('svg'));
                        const buttons = Array.from(article.querySelectorAll('button, [role="button"]'));
                        
                        // Сначала проверяем по aria-label (самый надежный способ)
                        for (const svg of svgElements) {
                            const ariaLabel = svg.getAttribute('aria-label');
                            if (ariaLabel && (
                                ariaLabel.toLowerCase() === 'like' || 
                                ariaLabel.toLowerCase() === 'нравится'
                            )) {
                                // Находим родительский элемент с возможностью клика
                                // Безопасная работа с DOM элементами
                                let parentElement = svg instanceof Element ? svg.parentElement : null;
                                let clickableElement = parentElement instanceof HTMLElement ? parentElement : null;
                                
                                // Ищем кликабельный элемент в родительской цепочке
                                while (parentElement && !parentElement.hasAttribute('role') && parentElement !== article) {
                                    if (parentElement instanceof HTMLElement) {
                                        clickableElement = parentElement;
                                    }
                                    parentElement = parentElement.parentElement;
                                }
                                
                                // Имитируем человеческий клик с небольшой задержкой
                                setTimeout(() => {
                                    try {
                                        // Нажимаем на найденный кликабельный элемент
                                        if (clickableElement) {
                                            clickableElement.click();
                                        } else {
                                            // Если не нашли подходящий элемент, пробуем другой подход
                                            const parentElement = svg instanceof Element ? svg.parentElement : null;
                                            if (parentElement instanceof HTMLElement) {
                                                parentElement.click();
                                            }
                                        }
                                    } catch (e) {
                                        console.error('Ошибка при клике на SVG элемент:', e);
                                    }
                                }, Math.random() * 250 + 100);
                                
                                return { success: true, method: 'aria_label' };
                            }
                        }
                        
                        // Проверяем все кнопки в секции взаимодействия (обычно в нижней части поста)
                        const sections = article.querySelectorAll('section');
                        if (sections.length > 0) {
                            const interactionSection = sections[sections.length - 1];
                            const sectionButtons = interactionSection.querySelectorAll('button, [role="button"]');
                            
                            if (sectionButtons.length > 0) {
                                // Обычно первая кнопка в секции взаимодействия - это лайк
                                const likeButton = sectionButtons[0];
                                
                                // Проверяем, не лайкнут ли уже пост
                                const svg = likeButton.querySelector('svg');
                                const ariaLabel = svg instanceof Element ? svg.getAttribute('aria-label') : null;
                                if (ariaLabel && ariaLabel.toLowerCase().includes('unlike')) {
                                    return { success: false, reason: 'already_liked' };
                                }
                                
                                setTimeout(() => {
                                    try {
                                        // Безопасное преобразование типа для клика
                                        if ('click' in likeButton) {
                                            (likeButton as any).click();
                                        } else {
                                            const parent = likeButton.parentElement as HTMLElement;
                                            if (parent) parent.click();
                                        }
                                    } catch (e) {
                                        console.error('Ошибка при клике:', e);
                                    }
                                }, Math.random() * 250 + 100);
                                
                                return { success: true, method: 'section_button' };
                            }
                        }
                        
                        return { success: false, reason: 'like_button_not_found' };
                    } catch (error) {
                        return { success: false, reason: 'error', message: String(error) };
                    }
                }, postSelector);
                
                if (likeButtonFound && likeButtonFound.success) {
                    console.log(`Пост ${postIndex} лайкнут через JavaScript (метод: ${likeButtonFound.method}).`);
                } else if (likeButtonFound && likeButtonFound.reason === 'already_liked') {
                    console.log(`Пост ${postIndex} уже лайкнут.`);
                } else {
                    console.log(`Не удалось найти кнопку лайка для поста ${postIndex}: ${likeButtonFound ? likeButtonFound.reason : 'неизвестная ошибка'}`);
                }
            } else {
                // Используем найденную кнопку
                if (ariaLabel === "Like" || ariaLabel === "Нравится" || !ariaLabel) {
                    // Случайная пауза перед нажатием (300-800 мс)
                    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500) + 300));
                    
                    console.log(`Лайкаем пост ${postIndex} с эмуляцией движения мыши...`);
                    try {
                        // Перед взаимодействием повторно получаем свежую ссылку на селектор кнопки
                        // Это помогает в случае, если DOM изменился между поиском и действием
                        const freshLikeButton = await page.$(`${postSelector} svg[aria-label="Like"], ${postSelector} svg[aria-label="Нравится"]`);
                        if (!freshLikeButton) {
                            throw new Error('Кнопка лайка исчезла перед взаимодействием');
                        }
                        
                        // Добавляем небольшую задержку для стабилизации DOM
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        // Получаем координаты элемента
                        const boundingBox = await freshLikeButton.boundingBox();
                        if (!boundingBox) {
                            throw new Error('Не удалось получить координаты элемента');
                        }

                        // Вычисляем центр с небольшим случайным смещением
                        const centerX = boundingBox.x + boundingBox.width / 2 + (Math.random() * 10 - 5);
                        const centerY = boundingBox.y + boundingBox.height / 2 + (Math.random() * 10 - 5);

                        // 1. Сначала плавно перемещаем мышь к элементу (human-like движение)
                        await page.mouse.move(centerX - 100, centerY - 100, { steps: 10 }); // Начинаем с позиции слева сверху
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 100) + 50)); // Небольшая задержка

                        // 2. Плавно двигаемся к точке назначения с небольшими движениями по кривой
                        // Имитируем человеческое движение с немного изогнутой траекторией
                        const controlPoints = [
                            { x: centerX - 50, y: centerY - 70 },
                            { x: centerX - 25, y: centerY - 40 },
                            { x: centerX - 5, y: centerY - 15 },
                            { x: centerX, y: centerY }
                        ];

                        for (let i = 0; i < controlPoints.length; i++) {
                            await page.mouse.move(controlPoints[i].x, controlPoints[i].y, { steps: 5 });
                            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 30) + 20));
                        }

                        // 3. Еще небольшая задержка перед кликом, как будто человек решает, кликать или нет
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 300) + 100));

                        // 4. Нажимаем левую кнопку мыши и удерживаем ее случайное время
                        await page.mouse.down();
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 80) + 30)); // Задержка 30-110 мс

                        // 5. Отпускаем кнопку
                        await page.mouse.up();

                        // 6. Ждем немного, имитируя послекликовое поведение
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 200) + 100));
                        
                        // 7. Отводим мышь в сторону (как будто переходим к следующему действию)
                        await page.mouse.move(centerX + 100, centerY + 50, { steps: 5 });

                        console.log(`Пост ${postIndex} успешно лайкнут с полной эмуляцией движения мыши.`);
                    } catch (error: unknown) {
                        console.log(`Ошибка при нажатии на кнопку лайка: ${error instanceof Error ? error.message : String(error)}`);
                        
                        // В случае ошибки пробуем запасной способ - напрямую через клик без движения
                        try {
                            console.log(`Пробуем запасной способ лайка...`);
                            await likeButton.click({ delay: Math.floor(Math.random() * 50) + 50, force: true });
                            console.log(`Пост ${postIndex} лайкнут запасным способом.`);
                        } catch (backupError: unknown) {
                            console.log(`И запасной способ не сработал: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
                        }
                    }
                } else if (ariaLabel === "Unlike" || ariaLabel === "Не нравится") {
                    console.log(`Пост ${postIndex} уже лайкнут.`);
                } else {
                    console.log(`Не удалось определить состояние кнопки лайка для поста ${postIndex}.`);
                }
            }

            // Extract and log the post caption
            const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
            const captionElement = await page.$(captionSelector);

            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
                console.log(`Caption for post ${postIndex}: ${caption}`);
            } else {
                console.log(`No caption found for post ${postIndex}.`);
            }

            // Check if there is a '...more' link to expand the caption
            const moreLinkSelector = `${postSelector} div.x9f619 span._ap3a span div span.x1lliihq`;
            const moreLink = await page.$(moreLinkSelector);
            if (moreLink) {
                console.log(`Expanding caption for post ${postIndex}...`);
                await moreLink.click(); // Click the '...more' link to expand the caption
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for the caption to expand
                const expandedCaption = await captionElement.evaluate(
                    (el: HTMLElement) => el.innerText
                );
                console.log(
                    `Expanded Caption for post ${postIndex}: ${expandedCaption}`
                );
                caption = expandedCaption; // Update caption with expanded content
            }

            // Комментируем пост только если достаточно текста в подписи (минимум 50 символов)
            if (!caption || caption.trim() === '' || caption.trim().length < 50) {
                console.log(`Пропускаем комментарий для поста ${postIndex} - текст слишком короткий (${caption ? caption.trim().length : 0} символов, нужно минимум 50)`);
            } else {
                // Добавляем случайную паузу перед комментированием (800-1800 мс)
                await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 1000) + 800));
                
                console.log(`Поиск поля комментария для поста ${postIndex}...`);
                
                // Используем несколько селекторов для надежного поиска поля комментария
                const commentBoxSelectors = [
                    `${postSelector} textarea`, 
                    `${postSelector} form textarea`,
                    `${postSelector} div[contenteditable="true"]`,
                    `${postSelector} div.x9f619 form textarea`,
                    `${postSelector} div[role="dialog"] textarea`
                ];
                
                let commentBox = null;
                
                // Пробуем все селекторы поочередно
                for (const selector of commentBoxSelectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            commentBox = element;
                            console.log(`Найдено поле комментария с селектором: ${selector}`);
                            break;
                        }
                    } catch (error: unknown) {
                        console.log(`Ошибка при поиске поля комментария с селектором ${selector}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                
                // Если не нашли поле, используем JavaScript для поиска
                if (!commentBox) {
                    console.log(`Используем JavaScript для поиска поля комментария...`);
                    
                    // Попытка найти поле комментария через JavaScript
                    const commentBoxResult = await page.evaluate((postSel: string) => {
                        try {
                            // Находим конкретный пост
                            const article = document.querySelector(postSel);
                            if (!article) return { success: false, reason: 'post_not_found' };
                            
                            // Способ 1: Прямой поиск по тегу textarea
                            const textareas = article.querySelectorAll('textarea');
                            if (textareas.length > 0) {
                                // Нажать на поле, чтобы активировать его
                                setTimeout(() => {
                                    try {
                                        (textareas[0] as HTMLTextAreaElement).focus();
                                        (textareas[0] as HTMLTextAreaElement).click();
                                    } catch (e) {
                                        console.error('Ошибка при активации поля textarea:', e);
                                    }
                                }, Math.random() * 300 + 100);
                                
                                return { success: true, method: 'textarea_found' };
                            }
                            
                            // Способ 2: Поиск по плейсхолдеру текста
                            const placeholderTexts = ['Add a comment...', 'Добавьте комментарий...', 'комментарий', 'comment'];
                            const allElements = article.querySelectorAll('*');
                            
                            for (const element of allElements) {
                                const placeholder = element.getAttribute('placeholder');
                                const ariaLabel = element.getAttribute('aria-label');
                                
                                if (placeholder && placeholderTexts.some(text => placeholder.toLowerCase().includes(text.toLowerCase()))) {
                                    setTimeout(() => {
                                        try {
                                            (element as HTMLElement).focus();
                                            (element as HTMLElement).click();
                                        } catch (e) {
                                            console.error('Ошибка при активации поля с плейсхолдером:', e);
                                        }
                                    }, Math.random() * 300 + 100);
                                    
                                    return { success: true, method: 'placeholder_found' };
                                }
                                
                                if (ariaLabel && placeholderTexts.some(text => ariaLabel.toLowerCase().includes(text.toLowerCase()))) {
                                    setTimeout(() => {
                                        try {
                                            (element as HTMLElement).focus();
                                            (element as HTMLElement).click();
                                        } catch (e) {
                                            console.error('Ошибка при активации поля с aria-label:', e);
                                        }
                                    }, Math.random() * 300 + 100);
                                    
                                    return { success: true, method: 'aria_label_found' };
                                }
                            }
                            
                            // Способ 3: Поиск по структуре документа (обычно комментарии внизу поста)
                            const sections = article.querySelectorAll('section');
                            if (sections.length > 0) {
                                const lastSection = sections[sections.length - 1];
                                const formElements = lastSection.querySelectorAll('form');
                                
                                if (formElements.length > 0) {
                                    const form = formElements[formElements.length - 1];
                                    const inputs = form.querySelectorAll('textarea, input, [contenteditable="true"]');
                                    
                                    if (inputs.length > 0) {
                                        setTimeout(() => {
                                            try {
                                                (inputs[0] as HTMLElement).focus();
                                                (inputs[0] as HTMLElement).click();
                                            } catch (e) {
                                                console.error('Ошибка при активации поля в форме:', e);
                                            }
                                        }, Math.random() * 300 + 100);
                                        
                                        return { success: true, method: 'form_input_found' };
                                    }
                                }
                            }
                            
                            return { success: false, reason: 'comment_box_not_found' };
                        } catch (error: unknown) {
                            return { success: false, reason: 'error', message: String(error) };
                        }
                    }, postSelector);
                    
                    // Проверяем результат поиска через JavaScript
                    if (commentBoxResult.success) {
                        console.log(`Найдено поле комментария через JavaScript: ${commentBoxResult.method}`);
                        
                        // После активации поля через JavaScript пробуем найти его снова
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500) + 500));
                        commentBox = await page.$(commentBoxSelectors[0]);
                    } else {
                        console.log(`Не удалось найти поле комментария для поста ${postIndex}: ${commentBoxResult ? commentBoxResult.reason : 'неизвестная ошибка'}`);
                    }
                }
                
                // Если нашли поле комментария, генерируем и добавляем комментарий
                if (commentBox) {
                    console.log(`Комментируем пост ${postIndex}...`);
                // Анализируем язык поста для генерации комментария на том же языке
                const detectLanguage = (text: string): string => {
                    const russianPattern = /[А-Яа-яЁё]/;
                    
                    if (russianPattern.test(text)) {
                        return 'ru';
                    }
                    
                    // Можно добавить проверку других языков при необходимости
                    return 'en'; // По умолчанию английский
                };
                
                const postLanguage = detectLanguage(caption);
                let promptTemplate = '';
                
                if (postLanguage === 'ru') {
                    promptTemplate = `Напиши вдумчивый, интересный и зрелый ответ на следующий пост: "${caption}". 
                    Убедись, что ответ актуален, содержателен и добавляет ценность беседе. 
                    Он должен отражать эмпатию и профессионализм, избегая слишком casual или поверхностного тона. 
                    Ответ должен быть не более 200 символов и не нарушать стандарты сообщества Instagram относительно спама. 
                    Постарайся сделать ответ максимально похожим на естественный человеческий комментарий на русском языке.`;
                } else {
                    promptTemplate = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". 
                    Ensure the reply is relevant, insightful, and adds value to the conversation. 
                    It should reflect empathy and professionalism, and avoid sounding too casual or superficial. 
                    The reply should be 200 characters or less and not go against Instagram Community Standards on spam. 
                    Try your best to humanize the reply and make it sound natural.`;
                }
                
                const prompt = promptTemplate;
                const schema = getInstagramCommentSchema();
                // Получаем комментарий от искусственного интеллекта
                let commentResult = await runAgent(schema, prompt);
                
                // Проверяем тип возвращаемого значения и обрабатываем его
                let comment = "";
                
                try {
                    if (typeof commentResult === 'string') {
                        // Проверяем, не является ли строка JSON
                        if (commentResult.trim().startsWith('{') || commentResult.trim().startsWith('[')) {
                            try {
                                const jsonData = JSON.parse(commentResult);
                                
                                // Извлекаем комментарий из разных возможных структур JSON
                                if (Array.isArray(jsonData) && jsonData.length > 0) {
                                    const firstItem = jsonData[0];
                                    comment = firstItem.comment || firstItem.text || firstItem.content || firstItem.message || '';
                                } else if (jsonData && typeof jsonData === 'object') {
                                    comment = jsonData.comment || jsonData.text || jsonData.content || jsonData.message || '';
                                }
                            } catch (jsonError) {
                                // Если не удалось разобрать как JSON, используем строку как есть
                                comment = commentResult;
                            }
                        } else {
                            // Не JSON строка, используем как есть
                            comment = commentResult;
                        }
                    } else if (commentResult && typeof commentResult === 'object') {
                        // Объект, пытаемся извлечь комментарий
                        if (Array.isArray(commentResult) && commentResult.length > 0) {
                            const firstItem = commentResult[0];
                            comment = firstItem.comment || firstItem.text || firstItem.content || firstItem.message || '';
                        } else {
                            comment = commentResult.comment || commentResult.text || commentResult.content || commentResult.message || '';
                        }
                        
                        // Если не удалось извлечь комментарий из объекта, преобразуем в строку
                        if (!comment) {
                            comment = JSON.stringify(commentResult);
                        }
                    } else {
                        // Другой тип, преобразуем в строку
                        comment = String(commentResult || '');
                    }
                } catch (extractError) {
                    console.error('Error extracting comment:', extractError);
                    comment = '';
                }
                
                // Если ничего не получилось, используем стандартный комментарий
                if (!comment || comment.trim() === '') {
                    comment = "Great post! Really enjoyed this content!"
                }
                
                // Убираем потенциально проблемные символы из комментария
                // Сохраняем латинские и кириллические символы, удаляем только потенциально опасные символы
                comment = comment.replace(/[^\x20-\x7E\u0400-\u04FF\s]/g, ''); // Сохраняем ASCII и кириллицу
                comment = comment.substring(0, 200); // Ограничиваем длину комментария
                console.log(`Generated comment: ${comment}`);
                try {
                    // Вводим текст комментария посимвольно с задержкой для имитации человеческого ввода
                    for (const char of comment) {
                        await commentBox.type(char);
                        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 50) + 10));
                    }
                } catch (error: unknown) {
                    if (error instanceof Error) {
                        console.error(`Error typing comment: ${error.message}`);
                    } else {
                        console.error(`Error typing comment: ${String(error)}`);
                    }
                    
                    // Альтернативный способ ввода комментария, если основной не сработал
                    try {
                        await page.evaluate((selector: string, text: string) => {
                            const element = document.querySelector(selector);
                            if (element) {
                                (element as HTMLInputElement).value = text;
                            }
                        }, commentBoxSelectors[0], comment);
                    } catch (evalError: unknown) {
                        if (evalError instanceof Error) {
                            console.error(`Failed alternative method: ${evalError.message}`);
                        } else {
                            console.error(`Failed alternative method: ${String(evalError)}`);
                        }
                    }
                }

                // Более надежный способ поиска кнопки публикации
                console.log(`Looking for the post button...`);
                
                // Ищем по атрибутам вместо текста (более стабильно)
                let postButton = null;
                try {
                    // Пробуем найти кнопку по нескольким возможным селекторам
                    const possibleButtonSelectors = [
                        `${postSelector} button[type="submit"]`,
                        `${postSelector} div[role="button"]`,
                        `${postSelector} div.x9f619 button`,
                        `${postSelector} div[data-visualcompletion="ignore-dynamic"] button`
                    ];
                    
                    for (const selector of possibleButtonSelectors) {
                        const button = await page.$(selector);
                        if (button) {
                            // Дополнительная проверка, что это кнопка публикации
                            const isEnabled = await button.evaluate((el: Element) => {
                                return !el.hasAttribute('disabled') && 
                                    (el.textContent?.includes('Post') || 
                                     el.textContent?.includes('Опубликовать') ||
                                     el.getAttribute('aria-label')?.includes('Post') ||
                                     el.getAttribute('aria-label')?.includes('Comment'));
                            });
                            
                            if (isEnabled) {
                                postButton = button;
                                console.log(`Found post button with selector: ${selector}`);
                                break;
                            }
                        }
                    }
                    
                    if (postButton) {
                        console.log(`Posting comment on post ${postIndex}...`);
                        await postButton.click();
                        console.log(`Comment posted on post ${postIndex}.`);
                        // Ждем немного после публикации комментария
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        console.log("Post button not found after trying all selectors.");
                        // Попробуем отправить комментарий через нажатие Enter
                        await commentBox.press('Enter');
                        console.log(`Tried posting comment using Enter key.`);
                    }
                } catch (btnError: unknown) {
                    if (btnError instanceof Error) {
                        console.error(`Error finding post button: ${btnError.message}`);
                    } else {
                        console.error(`Error finding post button: ${String(btnError)}`);
                    }
                }
            } else {
                console.log("Comment box not found.");
            }
        } // Закрываем блок для проверки наличия текста в посте

            // Wait before moving to the next post (randomize between 5 and 10 seconds)
            const delay = Math.floor(Math.random() * 5000) + 5000; // Random delay between 5 and 10 seconds
            console.log(
                `Waiting ${delay / 1000} seconds before moving to the next post...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));

            // Scroll to the next post
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            postIndex++; // Move to the next post
        } catch (error) {
            console.error(`Error interacting with post ${postIndex}:`, error);
            break;
        }
    }
}



export { runInstagram };

