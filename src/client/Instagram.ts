
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

            const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
            const likeButton = await page.$(likeButtonSelector);
            const ariaLabel = await likeButton?.evaluate((el: Element) =>
                el.getAttribute("aria-label")
            );

            if (ariaLabel === "Like") {
                console.log(`Liking post ${postIndex}...`);
                await likeButton.click();
                console.log(`Post ${postIndex} liked.`);
            } else if (ariaLabel === "Unlike") {
                console.log(`Post ${postIndex} is already liked.`);
            } else {
                console.log(`Like button not found for post ${postIndex}.`);
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

            // Comment on the post
            const commentBoxSelector = `${postSelector} textarea`;
            const commentBox = await page.$(commentBoxSelector);
            if (commentBox) {
                console.log(`Commenting on post ${postIndex}...`);
                const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". Ensure the reply is relevant, insightful, and adds value to the conversation. It should reflect empathy and professionalism, and avoid sounding too casual or superficial. also it should be 300 characters or less. and it should not go against instagram Community Standards on spam. so you will have to try your best to humanize the reply`;
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
                comment = comment.replace(/[^\x20-\x7E\s]/g, ''); // Оставляем только безопасные ASCII символы
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
                        }, commentBoxSelector, comment);
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

