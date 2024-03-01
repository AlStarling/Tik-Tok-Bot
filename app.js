const puppeteer = require('puppeteer');
const Tesseract = require('tesseract.js');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const filterText = (text) => {
    return text.replace(/[^a-zA-Z]/g, '');
};

const isValidText = (text) => {
    return /^[a-zA-Z]+$/.test(text);
};

const getUserInput = async (question) => {
    return new Promise((resolve) => {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        readline.question(question, (input) => {
            readline.close();
            resolve(input.trim());
        });
    });
};

const recognizeCaptcha = async (page) => {
    const captchaElement = await page.$('img.img-thumbnail.card-img-top.border-0');
    if (captchaElement) {
        const imageBoundingBox = await captchaElement.boundingBox();
        const imageBuffer = await page.screenshot({
            type: 'png',
            clip: {
                x: imageBoundingBox.x,
                y: imageBoundingBox.y,
                width: imageBoundingBox.width,
                height: imageBoundingBox.height,
            },
        });

        const result = await Tesseract.recognize(imageBuffer, 'eng');
        const recognizedText = filterText(result.data.text.trim());
        return recognizedText;
    }
    return null;
};

const submitForm = async (page, recognizedText) => {
    const inputPlaceholder = 'Enter the word';
    await page.type(`input[placeholder="${inputPlaceholder}"]`, recognizedText, { delay: 0 });

    const submitButtonSelector = '.submit-captcha';
    try {
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }),
            page.click(submitButtonSelector),
        ]);
    } catch (error) {
        console.log('Таймаут навигации. Повторная попытка...');
        return false;
    }
    return true;
};

const showAvailableButtons = async (page) => {
    const buttons = await page.$$('.card.m-b-20.card-body');
    console.log('Доступные кнопки:');
    const availableButtons = [];

    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        const titleElement = await button.$('h5.card-title');
        const buttonText = await page.evaluate(title => title.textContent.trim(), titleElement);
        const buttonElement = await button.$('button');
        const isButtonDisabled = await page.evaluate(button => button.disabled, buttonElement);

        if (!isButtonDisabled) {
            console.log(`[${availableButtons.length + 1}] - ${buttonText}`);
            availableButtons.push(buttonElement);
        }
    }

    return availableButtons;
};

const clickButtonAfterAppear = async (page, buttonSelector) => {
    try {
        await page.waitForSelector(buttonSelector, { visible: true, timeout: 5000 });
        await delay(1000);
        await page.click(buttonSelector);
        console.log('Кнопка успешно нажата!');
        return true;
    } catch (error) {
        console.log('Кнопка не появилась на странице. Продолжаем выполнение.');
        return false;
    }
};

const fillInputField = async (page, containerSelector, userInput) => {
    const container = await page.$(containerSelector);
    if (container) {
        const hasNonecClass = await page.evaluate(container => container.classList.contains('nonec'), container);

        if (!hasNonecClass) {
            const inputSelector = `${containerSelector} input[placeholder="Enter Video URL"]`;

            await page.waitForSelector(inputSelector);
            await page.focus(inputSelector);
            await page.$eval(inputSelector, (el, userInput) => el.value = userInput, userInput);
            console.log(`Инпут успешно заполнен текстом: ${userInput}`);
        } else {
            console.log('Найден контейнер с классом "nonec". Инпут не будет заполнен.');
        }
    } else {
        console.log('Контейнер не найден. Инпут не будет заполнен.');
    }
};

const clickSearchButtonPeriodically = async (page) => {
    try {
        const searchButtonSelector = '.col-sm-5:not(.nonec) .disableButton';
        await clickButtonAfterAppear(page, searchButtonSelector);
        await clickSubmitButtonIfVisible(page);
    } catch (error) {
        console.error('Ошибка при нажатии кнопки "Search":', error.message);
    } finally {
        setTimeout(async () => {
            await clickSearchButtonPeriodically(page);
        }, 60000);
    }
};

const clickSubmitButtonIfVisible = async (page) => {
    const submitButtonSelector = '.wbutton[type="submit"]';
    const isSubmitButtonVisible = await page.waitForSelector(submitButtonSelector, { visible: true, timeout: 5000 }).catch(() => false);
    if (isSubmitButtonVisible) {
        await page.click(submitButtonSelector);
        console.log('Кнопка "Submit" успешно нажата!');
    } else {
        console.log('Кнопка "Submit" не появилась на странице. Продолжаем нажимать кнопку "Search"...');
    }
};

const main = async () => {
    try {
        let userInputText = await getUserInput('Введите текст: ');

        const browser = await puppeteer.launch({
        headless: "new", 
        executablePath: './chrome-win/chrome.exe',
        args: [
        '--enable-notifications',
        '--disable-popup-blocking',
        ]
        });

        const pages = await browser.pages();
        const page = pages[0];
        await page.setViewport({ width: 1000, height: 1000 });
        await page.goto('https://zefoy.com');

        let recognizedText;
        do {
            recognizedText = await recognizeCaptcha(page);
            if (recognizedText && !isValidText(recognizedText)) {
                console.log('Некорректный текст. Повторная попытка...');
                await delay(500);
            } else if (recognizedText) {
                const formSubmitted = await submitForm(page, recognizedText);
                if (formSubmitted) {
                    await delay(1000);
                }
            }
        } while (recognizedText);

        console.log('Капча успешно пройдена и форма отправлена!');

        const availableButtons = await showAvailableButtons(page);

        if (availableButtons.length === 0) {
            console.log('Нет доступных кнопок для выбора.');
            return;
        }

        let selectedButtonIndex;
        do {
            const userInput = await getUserInput('Введите номер кнопки, которую вы хотите нажать: ');
            const index = parseInt(userInput);
            selectedButtonIndex = index - 1;
            if (isNaN(selectedButtonIndex) || selectedButtonIndex < 0 || selectedButtonIndex >= availableButtons.length) {
                console.log('Некорректный номер кнопки. Попробуйте еще раз.');
            } else {
                break;
            }
        } while (true);

        const selectedButton = availableButtons[selectedButtonIndex];
        await selectedButton.click();
        console.log('Кнопка успешно нажата!');

        await fillInputField(page, '.col-sm-5:not(.nonec)', userInputText);

        await clickSearchButtonPeriodically(page);

    } catch (error) {
        console.error('Произошла ошибка:', error.message);
    }
};

main();
