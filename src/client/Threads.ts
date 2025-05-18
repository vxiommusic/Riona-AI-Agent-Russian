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

// Добавляем плагины для puppeteer (важно для избежания обнаружения)
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

/**
 * Основная функция для запуска бота Threads
 */
async function runThreads() {
    // Создаем локальный прокси-сервер для обхода ограничений
    const server = new Server({ port: 8002 });
    await server.listen();
    const checkMode = process.env.NODE_ENV === "production" ? true : false;
    const proxyUrl = `http://localhost:8002`;
    const browser: Browser = await puppeteer.launch({
        headless: checkMode,
        args: [`--proxy-server=${proxyUrl}`, `--disable-features=site-per-process`], // Дополнительные аргументы для обхода защиты
    });

    try {
        // Проверяем наличие и загружаем cookies, если они существуют
        if (await Instagram_cookiesExist()) {
            logger.info("Loading cookies...:🚧");
            const cookies = await loadCookies("./cookies/Instagramcookies.json");
            await browser.setCookie(...cookies);
        }
        const page = await browser.newPage();

        // Устанавливаем случайный User-Agent для ПК
        const userAgent = new UserAgent({ deviceCategory: "desktop" });
        const randomUserAgent = userAgent.toString();
        logger.info(`Using user-agent: ${randomUserAgent}`);
        await page.setUserAgent(randomUserAgent);

        // Проверяем cookies
        if (await Instagram_cookiesExist()) {
            logger.info("Cookies loaded, trying to use for Threads...");
            // Переходим на страницу Threads
            await page.goto("https://www.threads.com", { waitUntil: "networkidle2" });

            // Проверяем, успешен ли вход по куки
            const isLoggedIn = await page.$("button[aria-label='New thread']") || 
                               await page.$("a[href='/direct/inbox/']") ||
                               await page.$("[aria-label='Menu']");
                               
            if (isLoggedIn) {
                logger.info("Login verified with cookies on Threads.");
            } else {
                logger.warn("Cookies invalid or expired. Logging in again...");
                await loginWithCredentials(page, browser);
            }
        } else {
            // Если нет куки, выполняем вход с учетными данными
            await loginWithCredentials(page, browser);
        }

        // Делаем скриншот после входа
        await page.screenshot({ path: "threads_logged_in.png" });

        // Переходим к ленте предпринимательства
        await page.goto("https://www.threads.com/custom_feed/18059649997908421", { 
            waitUntil: "networkidle2",
            timeout: 60000 // Увеличенный таймаут для медленных соединений
        });

        // Ждем загрузки ленты
        await page.waitForSelector('article', { timeout: 30000 });
        logger.info("Successfully navigated to entrepreneurship feed.");

        // Взаимодействуем с постами в ленте
        await interactWithThreadsPosts(page);

    } catch (error) {
        logger.error("Error running Threads bot:", error);
    } finally {
        // Закрываем браузер и прокси
        await browser.close();
        await server.close(true);
        logger.info("Threads session completed.");
    }
}

/**
 * Функция входа в аккаунт с использованием учетных данных
 */
const loginWithCredentials = async (page: any, browser: Browser) => {
    try {
        // Переходим на страницу входа Threads, которая перенаправит на Instagram
        await page.goto("https://www.threads.com/login", { waitUntil: "networkidle2" });
        logger.info("Перешли на страницу авторизации Threads/Instagram...");
        
        // Делаем скриншот для отладки
        await page.screenshot({ path: "instagram_login_page.png" });
        
        // Проверяем наличие полей для ввода логина и пароля и ждём их появления
        logger.info("Ожидаем элементы формы авторизации...");
        // Используем более надёжные селекторы по типу поля
        await page.waitForSelector('input[type="text"]', { timeout: 15000 });
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        
        // Ждем еще немного, чтобы убедиться, что форма полностью загружена
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Замедляем ввод для имитации человеческого поведения
        logger.info(`Вводим учетные данные для ${IGusername}...`);
        await typeWithHumanSpeed(page, 'input[type="text"]', IGusername);
        await typeWithHumanSpeed(page, 'input[type="password"]', IGpassword);
        
        // Делаем паузу перед отправкой формы (как человек)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        
        // Самый надёжный способ - нажать ENTER после ввода пароля
        logger.info("Нажимаем ENTER для отправки формы входа...");
        await page.keyboard.press('Enter');
        
        // Делаем небольшую паузу для завершения процесса отправки формы
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logger.info("Авторизация выполнена, ожидаем редирект...");
        
        // Ждем завершения авторизации (возможно, будут проверки безопасности)
        logger.info("Ожидаем завершения процесса авторизации...");
        try {
            // Проверяем, есть ли запрос на сохранение авторизации
            const saveLoginPrompt = await Promise.race([
                page.waitForSelector('button:has-text("Сохранить")', { timeout: 5000 }).then(() => true),
                page.waitForSelector('button:has-text("Save")', { timeout: 5000 }).then(() => true),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
            
            if (saveLoginPrompt) {
                logger.info("Обнаружено предложение сохранить данные...");
                await page.click('button:has-text("Сохранить"), button:has-text("Save")');
            }
            
            // Проверяем, есть ли уведомление о включении уведомлений
            const notificationPrompt = await Promise.race([
                page.waitForSelector('button:has-text("Не сейчас")', { timeout: 5000 }).then(() => true),
                page.waitForSelector('button:has-text("Not Now")', { timeout: 5000 }).then(() => true),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
            
            if (notificationPrompt) {
                logger.info("Обнаружено предложение о включении уведомлений...");
                await page.click('button:has-text("Не сейчас"), button:has-text("Not Now")');
            }
        } catch (promptError) {
            logger.warn("Не обнаружено дополнительных запросов после входа:", promptError);
        }
        
        // Ждем перенаправления на Threads или другую страницу Instagram
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {
            logger.info("Таймаут ожидания перенаправления - продолжаем работу");
        });
        
        // Делаем скриншот для проверки успешности входа
        await page.screenshot({ path: "instagram_logged_in.png" });
        
        // Сохраняем куки после входа
        logger.info("Сохраняем cookies после авторизации...");
        const cookies = await browser.cookies();
        await saveCookies("./cookies/Instagramcookies.json", cookies);
        logger.info("Successfully logged in and saved cookies.");
        
        // Переходим на Threads после авторизации
        logger.info("Переходим на Threads после авторизации...");
        await page.goto("https://www.threads.com", { waitUntil: "networkidle2", timeout: 30000 });
        
    } catch (error) {
        logger.error("Error logging in with credentials:", error);
        // Делаем скриншот ошибки
        await page.screenshot({ path: "instagram_login_error.png" });
    }
}

/**
 * Функция взаимодействия с постами в ленте Threads
 */
async function interactWithThreadsPosts(page: any) {
    let postIndex = 1; // Начинаем с первого поста
    const maxPosts = 20; // Лимит постов для обработки
    
    while (postIndex <= maxPosts) {
        try {
            console.log(`\n====\nОбработка треда #${postIndex}...\n====`);
            
            // Селектор для текущего поста
            const postSelector = `article:nth-of-type(${postIndex})`;
            
            // Проверяем существование поста
            if (!(await page.$(postSelector))) {
                console.log("Больше тредов не найдено. Прокручиваем страницу...");
                
                // Запоминаем текущее количество постов
                const currentPostCount = await page.$$eval('article', (posts: Element[]) => posts.length);
                console.log(`Текущее количество тредов: ${currentPostCount}`);
                
                // Прокручиваем страницу для загрузки новых постов
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 0.8);
                });
                
                // Ждем загрузки новых постов (1-3 секунды)
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
                
                // Проверяем, загрузились ли новые посты
                const newPostCount = await page.$$eval('article', (posts: Element[]) => posts.length);
                if (newPostCount > currentPostCount) {
                    console.log(`Загружено ${newPostCount - currentPostCount} новых тредов.`);
                    continue; // Продолжаем с тем же индексом
                } else {
                    console.log("Новых тредов не загружено. Завершаем работу.");
                    break;
                }
            }
            
            // Добавляем случайную паузу перед взаимодействием с постом (1-2 сек)
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
            
            // === Комментирование треда ===
            // 1. Получаем текст треда для генерации релевантного комментария
            let threadText = await page.evaluate((selector: string) => {
                const threadElement = document.querySelector(selector);
                if (!threadElement) return "";
                
                // Получаем текст основного поста
                const textElements = threadElement.querySelectorAll('div[dir="auto"] > span');
                let text = "";
                textElements.forEach(el => {
                    text += el.textContent + " ";
                });
                return text.trim();
            }, postSelector);
            
            console.log(`Текст треда #${postIndex}: ${threadText.substring(0, 100)}${threadText.length > 100 ? '...' : ''}`);
            
            if (threadText.length >= 50) {
                // Используем AI для генерации комментария на основе текста
                const detectedLanguage = detectLanguage(threadText);
                const comment = await generateComment(threadText, detectedLanguage);
                
                console.log(`Сгенерирован комментарий (${detectedLanguage}): ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`);
                
                // Находим и кликаем на кнопку "Reply"
                const replyButtonSelector = `${postSelector} [aria-label="Reply"], ${postSelector} [aria-label="Ответить"]`;
                const replyButton = await page.$(replyButtonSelector);
                
                if (replyButton) {
                    // Имитируем человеческий клик
                    await humanClick(page, replyButtonSelector);
                    console.log("Нажата кнопка ответа.");
                    
                    // Ждем появления поля для комментария
                    await page.waitForSelector('textarea[placeholder]', { timeout: 5000 })
                        .catch(() => console.log("Не удалось найти поле для комментария"));
                    
                    // Вводим комментарий с человеческой скоростью печати
                    const commentSuccess = await typeWithHumanSpeed(page, 'textarea[placeholder]', comment);
                    
                    if (commentSuccess) {
                        // Находим и кликаем на кнопку отправки
                        const postButtonSelector = 'button[type="submit"]';
                        const postButton = await page.$(postButtonSelector);
                        
                        if (postButton) {
                            // Случайная задержка перед отправкой (0.5-1.5 сек)
                            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
                            
                            await humanClick(page, postButtonSelector);
                            console.log("Комментарий отправлен.");
                            
                            // Ждем завершения отправки комментария
                            await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
                        } else {
                            console.log("Кнопка отправки не найдена.");
                        }
                    } else {
                        console.log("Не удалось ввести комментарий.");
                    }
                } else {
                    console.log("Кнопка ответа не найдена.");
                }
            } else {
                console.log(`Пропускаем комментирование - текст слишком короткий (${threadText.length} символов, нужно минимум 50)`);
            }
            
            // Случайная задержка перед переходом к следующему посту (4-8 сек)
            const delay = Math.floor(Math.random() * 4000) + 4000;
            console.log(`Ожидание ${delay / 1000} секунд перед следующим тредом...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            postIndex++; // Переходим к следующему посту
        } catch (error) {
            console.error(`Ошибка при обработке треда #${postIndex}:`, error);
            // Продолжаем со следующим постом в случае ошибки
            postIndex++;
            await new Promise(resolve => setTimeout(resolve, 3000)); // Пауза после ошибки
        }
    }
}

/**
 * Определение языка текста
 */
function detectLanguage(text: string): string {
    // Базовое определение языка
    const russianPattern = /[а-яА-ЯёЁ]/;
    const indonesianPattern = /(\bdan\b|\byang\b|\bdi\b|\buntuk\b|\bini\b)/i;
    
    if (russianPattern.test(text)) return "ru";
    if (indonesianPattern.test(text)) return "id";
    
    // По умолчанию считаем английским
    return "en";
}

/**
 * Генерация комментария с использованием модели Google AI
 */
async function generateComment(text: string, language: string): Promise<string> {
    try {
        // Получаем схему комментария (schema не принимает параметров)
        const schema = getInstagramCommentSchema();
        
        // Добавляем информацию о языке в промпт
        const promptWithLang = `[Language: ${language}] ${text}`;
        
        // Вызываем runAgent с правильным порядком аргументов: schema, prompt
        const response = await runAgent(schema, promptWithLang);
        return response || "Great post! 👍";
    } catch (error) {
        console.error("Error generating comment:", error);
        return language === "ru" 
            ? "Отличный пост! 👍" 
            : language === "id" 
                ? "Postingan yang bagus! 👍" 
                : "Great post! 👍";
    }
}

/**
 * Имитация человеческого клика с движением мыши
 */
async function humanClick(page: any, selector: string): Promise<boolean> {
    try {
        // Получаем размеры и позицию элемента
        const elementHandle = await page.$(selector);
        if (!elementHandle) return false;
        
        const box = await elementHandle.boundingBox();
        if (!box) return false;
        
        // Случайное смещение внутри элемента
        const offsetX = Math.floor(Math.random() * (box.width * 0.6) + box.width * 0.2);
        const offsetY = Math.floor(Math.random() * (box.height * 0.6) + box.height * 0.2);
        
        // Перемещение мыши в позицию с небольшой задержкой
        await page.mouse.move(box.x + offsetX, box.y + offsetY, { steps: 10 + Math.floor(Math.random() * 15) });
        
        // Короткая пауза перед кликом (100-300ms)
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        // Клик
        await page.mouse.down();
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
        await page.mouse.up();
        
        return true;
    } catch (error) {
        console.error("Error simulating human click:", error);
        return false;
    }
}

/**
 * Имитация ввода текста с человеческой скоростью
 */
async function typeWithHumanSpeed(page: any, selector: string, text: string): Promise<boolean> {
    try {
        const element = await page.$(selector);
        if (!element) return false;
        
        // Фокусируемся на элементе
        await element.focus();
        
        // Вводим текст по символам с разной скоростью
        for (const char of text) {
            await page.keyboard.type(char);
            
            // Случайная задержка между нажатиями клавиш (30-100ms)
            const delay = Math.floor(Math.random() * 70) + 30;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Иногда делаем более длинную паузу (как будто человек задумался)
            if (Math.random() < 0.05) {
                await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 700));
            }
        }
        
        return true;
    } catch (error) {
        console.error("Error typing with human speed:", error);
        return false;
    }
}

// Экспортируем функцию runThreads для вызова из index.ts
export { runThreads };