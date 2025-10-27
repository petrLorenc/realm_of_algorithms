/**
 * Python Code Tester with WASM
 * Main application logic
 */

// Application state
const AppState = {
    pyodide: null,
    testCaseCounter: 0,
    isInitialized: false
};

// DOM Elements cache
const DOMElements = {
    codeEditor: null,
    testCaseSelector: null,
    testCaseInstructions: null,
    testCasesContainer: null,
    runBtn: null,
    resultsDiv: null,
    
    init() {
        this.codeEditor = document.getElementById('code-editor');
        this.testCaseSelector = document.getElementById('test-case-selector');
        this.testCaseInstructions = document.getElementById('test-case-instructions');
        this.testCasesContainer = document.getElementById('test-cases');
        this.runBtn = document.getElementById('run-btn');
        this.resultsDiv = document.getElementById('results');
    }
};

// Pyodide initialization module
const PyodideManager = {
    async initialize() {
        UIManager.showLoadingPyodide();
        try {
            AppState.pyodide = await loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.20.0/full/"
            });

            // Install any required packages
            await AppState.pyodide.loadPackage(['numpy', 'micropip']);

            AppState.isInitialized = true;
            UIManager.showMessage('✅ Pyodide initialized successfully! Ready to run tests.', 'success');
        } catch (error) {
            UIManager.showMessage(`❌ Failed to initialize Pyodide: ${error}`, 'error');
            throw error;
        }
    },

    setupPythonEnvironment() {
        AppState.pyodide.runPython(`
import sys
import time
import traceback
import json
import gc
from io import StringIO

def robust_benchmark(func, input_data, num_runs=100, warmup_runs=10):
    """
    Perform robust benchmarking with:
    - Warm-up runs to stabilize JIT/caching
    - Multiple measurements
    - Outlier removal using IQR method
    - Statistical analysis
    """
    # Prepare function arguments once
    if isinstance(input_data, list):
        args = input_data
        kwargs = {}
    elif isinstance(input_data, dict):
        args = []
        kwargs = input_data
    else:
        args = [input_data]
        kwargs = {}
    
    # Warm-up phase - let JIT and caching stabilize
    for _ in range(warmup_runs):
        try:
            if kwargs:
                _ = func(**kwargs)
            else:
                _ = func(*args)
        except:
            pass
    
    # Force garbage collection before measurement
    gc.collect()
    
    # Measurement phase
    times = []
    result = None
    
    for _ in range(num_runs):
        start = time.perf_counter()
        if kwargs:
            result = func(**kwargs)
        else:
            result = func(*args)
        end = time.perf_counter()
        times.append(end - start)
    
    # Remove outliers using IQR method
    times_sorted = sorted(times)
    n = len(times_sorted)
    q1_idx = n // 4
    q3_idx = 3 * n // 4
    q1 = times_sorted[q1_idx]
    q3 = times_sorted[q3_idx]
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    
    # Filter outliers
    filtered_times = [t for t in times if lower_bound <= t <= upper_bound]
    
    # If too many outliers removed, use all data
    if len(filtered_times) < num_runs * 0.5:
        filtered_times = times
    
    # Calculate statistics
    mean_time = sum(filtered_times) / len(filtered_times)
    median_time = times_sorted[len(times_sorted) // 2]
    min_time = min(filtered_times)
    max_time = max(filtered_times)
    
    # Standard deviation
    variance = sum((t - mean_time) ** 2 for t in filtered_times) / len(filtered_times)
    std_dev = variance ** 0.5
    
    # Coefficient of variation (lower is more consistent)
    cv = (std_dev / mean_time * 100) if mean_time > 0 else 0
    
    return {
        'result': result,
        'mean_time': mean_time,
        'median_time': median_time,
        'min_time': min_time,
        'max_time': max_time,
        'std_dev': std_dev,
        'cv_percent': cv,
        'num_runs': num_runs,
        'num_valid': len(filtered_times),
        'outliers_removed': num_runs - len(filtered_times)
    }

def measure_memory_usage(func, input_data, num_samples=10):
    """
    Measure memory using multiple samples - tracking peak allocations
    """
    # Prepare arguments
    if isinstance(input_data, list):
        args = input_data
        kwargs = {}
    elif isinstance(input_data, dict):
        args = []
        kwargs = input_data
    else:
        args = [input_data]
        kwargs = {}
    
    memory_measurements = []
    
    for _ in range(num_samples):
        # Force garbage collection and measure baseline
        gc.collect()
        gc.collect()
        
        # Get baseline object count and sizes
        objects_before = gc.get_objects()
        count_before = len(objects_before)
        
        # Calculate approximate size of current objects
        size_before = 0
        try:
            for obj in objects_before[:1000]:  # Sample first 1000 objects to avoid slowdown
                try:
                    size_before += sys.getsizeof(obj)
                except:
                    pass
        except:
            pass
        
        # Execute function
        if kwargs:
            result = func(**kwargs)
        else:
            result = func(*args)
        
        # Measure after execution (before GC)
        objects_after = gc.get_objects()
        count_after = len(objects_after)
        
        # Calculate approximate size after
        size_after = 0
        try:
            for obj in objects_after[:1000]:
                try:
                    size_after += sys.getsizeof(obj)
                except:
                    pass
        except:
            pass
        
        # Try to measure the result object itself
        result_size = 0
        try:
            result_size = sys.getsizeof(result)
            # If result is a container, measure contents too
            if hasattr(result, '__iter__') and not isinstance(result, (str, bytes)):
                for item in list(result)[:100]:  # Sample first 100 items
                    try:
                        result_size += sys.getsizeof(item)
                    except:
                        pass
        except:
            pass
        
        # Calculate deltas
        object_delta = count_after - count_before
        size_delta = abs(size_after - size_before)
        
        memory_measurements.append({
            'object_delta': object_delta,
            'size_delta': size_delta,
            'result_size': result_size,
            'total_estimate': object_delta * 56 + size_delta + result_size  # 56 bytes per object overhead
        })
        
        # Clean up for next iteration
        del result
        gc.collect()
    
    # Calculate statistics
    object_deltas = [m['object_delta'] for m in memory_measurements]
    size_deltas = [m['size_delta'] for m in memory_measurements]
    result_sizes = [m['result_size'] for m in memory_measurements]
    total_estimates = [m['total_estimate'] for m in memory_measurements]
    
    # Remove outliers from each metric
    def remove_outliers(data):
        if len(data) < 4:
            return data
        sorted_data = sorted(data)
        n = len(sorted_data)
        q1_idx = n // 4
        q3_idx = 3 * n // 4
        q1 = sorted_data[q1_idx]
        q3 = sorted_data[q3_idx]
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        filtered = [x for x in data if lower_bound <= x <= upper_bound]
        return filtered if len(filtered) >= len(data) * 0.5 else data
    
    object_deltas = remove_outliers(object_deltas)
    total_estimates = remove_outliers(total_estimates)
    
    return {
        'mean_objects': sum(object_deltas) / len(object_deltas) if object_deltas else 0,
        'median_objects': sorted(object_deltas)[len(object_deltas) // 2] if object_deltas else 0,
        'min_objects': min(object_deltas) if object_deltas else 0,
        'max_objects': max(object_deltas) if object_deltas else 0,
        'mean_bytes': sum(total_estimates) / len(total_estimates) if total_estimates else 0,
        'median_bytes': sorted(total_estimates)[len(total_estimates) // 2] if total_estimates else 0,
        'result_size_bytes': sum(result_sizes) / len(result_sizes) if result_sizes else 0
    }

def run_test_function(code, input_data, num_runs=100, warmup_runs=10, memory_samples=10):
    """
    Run comprehensive test with robust benchmarking
    """
    # Create a clean namespace
    namespace = {}
    
    # Execute the user code
    exec(code, namespace)
    
    func = namespace.get('solution')
    if not func:
        raise Exception("No callable function found. Please define a function 'solution'")
    
    # Redirect stdout to capture prints
    old_stdout = sys.stdout
    sys.stdout = captured_output = StringIO()
    
    try:
        # Run timing benchmark
        timing_stats = robust_benchmark(func, input_data, num_runs, warmup_runs)
        
        # Run memory benchmark
        memory_stats = measure_memory_usage(func, input_data, memory_samples)
        
        # Get any printed output
        printed_output = captured_output.getvalue()
        
        return {
            'success': True,
            'result': timing_stats['result'],
            'execution_time': timing_stats['mean_time'],
            'median_time': timing_stats['median_time'],
            'min_time': timing_stats['min_time'],
            'max_time': timing_stats['max_time'],
            'std_dev': timing_stats['std_dev'],
            'cv_percent': timing_stats['cv_percent'],
            'num_runs': timing_stats['num_runs'],
            'outliers_removed': timing_stats['outliers_removed'],
            'memory_objects': memory_stats['mean_objects'],
            'memory_median': memory_stats['median_objects'],
            'memory_bytes': memory_stats['mean_bytes'],
            'memory_median_bytes': memory_stats['median_bytes'],
            'result_size_bytes': memory_stats['result_size_bytes'],
            'printed_output': printed_output.strip() if printed_output.strip() else None,
            'error': None
        }
    except Exception as e:
        return {
            'success': False,
            'result': None,
            'execution_time': 0,
            'median_time': 0,
            'min_time': 0,
            'max_time': 0,
            'std_dev': 0,
            'cv_percent': 0,
            'num_runs': 0,
            'outliers_removed': 0,
            'memory_objects': 0,
            'memory_median': 0,
            'memory_bytes': 0,
            'memory_median_bytes': 0,
            'result_size_bytes': 0,
            'printed_output': None,
            'error': str(e) + '\\n' + traceback.format_exc()
        }
    finally:
        sys.stdout = old_stdout
        `);
    }
};

// Test case management
const TestCaseManager = {
    problems: {
        '1': {
            title: 'What is the maximum sum of continuous subsequence of elements in a unsorted sequence?',
            testCases: [
                { input: '1,2,3,-4,-5,6,7', expectedOutput: '13' },
                { input: '1,2,3,4,-4,-5,6,7', expectedOutput: '14' },
                { input: '1,-1,-2,33', expectedOutput: '33' },
                { input: '33,-30,33', expectedOutput: '36' },
                { input: '-1,-30,-2', expectedOutput: '0' }

            ]
        },
        '2': {
            title: 'How many variants of getting certain number by summing two different numbers in ordered sequence? (number, array)',
            testCases: [
                { input: '3,[0,1,2,3]', expectedOutput: '2' },
                { input: '4,[0,4,5,6]', expectedOutput: '1' },
                { input: '11,[1,2,3,4,5,5,6,10]', expectedOutput: '3' }
            ]
        }
    },

    loadProblem(problemId) {
        this.clearAll();
        const problem = this.problems[problemId];
        
        if (!problem) {
            console.error(`Problem ${problemId} not found`);
            return;
        }

        DOMElements.testCaseInstructions.innerHTML = `<p>${problem.title}</p>`;
        
        problem.testCases.forEach(testCase => {
            this.addTestCase(testCase.input, testCase.expectedOutput);
        });
    },

    addTestCase(givenInput, expectedOutput) {
        AppState.testCaseCounter++;
        
        const testCaseDiv = document.createElement('div');
        testCaseDiv.className = 'test-case';
        testCaseDiv.id = `test-case-${AppState.testCaseCounter}`;

        testCaseDiv.innerHTML = `
            <h3>Test Case ${AppState.testCaseCounter}</h3>
            <div class="input-output-row">
                <div>
                    <label>Input (String format):</label>
                    <textarea disabled="true">${this.escapeHtml(givenInput)}</textarea>
                </div>
                <div>
                    <label>Expected Output:</label>
                    <textarea disabled="true">${this.escapeHtml(expectedOutput)}</textarea>
                </div>
            </div>
        `;

        DOMElements.testCasesContainer.appendChild(testCaseDiv);
    },

    clearAll() {
        DOMElements.testCasesContainer.innerHTML = '';
        AppState.testCaseCounter = 0;
    },

    collectTestCases() {
        const testCases = [];
        const testCaseElements = document.querySelectorAll('.test-case');

        testCaseElements.forEach((element) => {
            const textareas = element.querySelectorAll('textarea');
            if (textareas.length >= 2) {
                const input = textareas[0].value.trim();
                const expectedOutput = textareas[1].value.trim();

                if (input && expectedOutput) {
                    testCases.push({ input, expectedOutput });
                }
            }
        });

        return testCases;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Test execution module
const TestRunner = {
    async runTests() {
        UIManager.clearResults();
        
        if (!AppState.isInitialized) {
            UIManager.showMessage('❌ Pyodide not initialized yet. Please wait...', 'error');
            return;
        }

        const code = DOMElements.codeEditor.value.trim();
        if (!code) {
            UIManager.showMessage('❌ Please enter some Python code to test.', 'error');
            return;
        }

        const testCases = TestCaseManager.collectTestCases();
        if (testCases.length === 0) {
            UIManager.showMessage('❌ No test cases found. Please add test cases.', 'error');
            return;
        }

        DOMElements.runBtn.disabled = true;
        UIManager.showLoading();

        // Use a short timeout to allow the UI to update before heavy processing
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            // Setup Python environment once
            PyodideManager.setupPythonEnvironment();

            const results = [];
            let totalTime = 0;
            let passedTests = 0;
            let failedTests = 0;

            for (let i = 0; i < testCases.length; i++) {
                const testCase = testCases[i];

                try {
                    // Run the test
                    AppState.pyodide.globals.set("user_code", code);
                    AppState.pyodide.globals.set("test_input", testCase.input);

                    const result = AppState.pyodide.runPython(`
result_data = run_test_function(user_code, test_input)
result_data
                    `).toJs({ dict_converter: Object.fromEntries });

                    totalTime += result.execution_time;

                    // Compare results
                    const actualResult = result.result;
                    const expectedOutput = testCase.expectedOutput;
                    let passed = false;

                    if (typeof expectedOutput === 'object' && typeof actualResult === 'object') {
                        passed = JSON.stringify(expectedOutput) === JSON.stringify(actualResult);
                    } else {
                        passed = expectedOutput == actualResult;
                    }

                    if (passed) {
                        passedTests++;
                    } else {
                        failedTests++;
                    }

                    results.push({
                        testNumber: i + 1,
                        passed,
                        input: testCase.input,
                        expected: testCase.expectedOutput,
                        actual: actualResult,
                        executionTime: result.execution_time,
                        medianTime: result.median_time,
                        minTime: result.min_time,
                        maxTime: result.max_time,
                        stdDev: result.std_dev,
                        cvPercent: result.cv_percent,
                        numRuns: result.num_runs,
                        outliersRemoved: result.outliers_removed,
                        memoryObjects: result.memory_objects,
                        memoryMedian: result.memory_median,
                        memoryBytes: result.memory_bytes,
                        memoryMedianBytes: result.memory_median_bytes,
                        resultSizeBytes: result.result_size_bytes,
                        printedOutput: result.printed_output,
                        error: result.error,
                        success: result.success
                    });

                } catch (error) {
                    failedTests++;
                    results.push({
                        testNumber: i + 1,
                        passed: false,
                        input: testCase.input,
                        expected: testCase.expectedOutput,
                        actual: null,
                        executionTime: 0,
                        error: error.message,
                        success: false
                    });
                }

                // Display intermediate results
                UIManager.displayResults(results, passedTests, failedTests, totalTime, false);
                // Allow UI to repaint
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            // Display final results
            UIManager.displayResults(results, passedTests, failedTests, totalTime, true);

        } catch (error) {
            UIManager.showMessage(`❌ Error: ${error.message}`, 'error');
        } finally {
            DOMElements.runBtn.disabled = false;
        }
    }
};

// UI management module
const UIManager = {
    showMessage(message, type = 'info') {
        DOMElements.resultsDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
    },

    showLoadingPyodide() {
        DOMElements.resultsDiv.innerHTML = `
            <div class="loading-container">
                <div class="loading-text">🔄 Loading Pyodide...</div>
            </div>
        `;
    },

    showLoading() {
        DOMElements.resultsDiv.innerHTML = `
            <div class="loading-container">
                <div class="spinner"></div>
                <div class="loading-text">🔄 Running tests...</div>
            </div>
        `;
    },

    clearResults() {
        DOMElements.resultsDiv.innerHTML = '';
        DOMElements.resultsDiv.textContent = '';
        console.log('Results cleared.');
    },

    displayResults(results, passedTests, failedTests, totalTime, isFinal) {
        let html = '';

        // Summary
        const overallStatus = failedTests === 0 ? 'success' : 'error';
        const statusIcon = failedTests === 0 ? '✅' : '❌';

        const summaryText = isFinal
            ? `Tests completed: ${passedTests} passed, ${failedTests} failed`
            : `Running... ${passedTests} passed, ${failedTests} failed so far`;

        html += `<div class="status ${overallStatus}">
            ${statusIcon} ${summaryText}
        </div>`;

        // Performance summary
        const avgTimePerTest = totalTime > 0 ? (totalTime * 1000 / results.length) : 0;
        const avgMemoryPerTest = results.reduce((sum, r) => sum + (r.memoryBytes || 0), 0) / results.length / 1024;

        html += `<div class="performance-stats">
            📊 <strong>Performance Summary:</strong><br>
            Total execution time: ${(totalTime * 1000).toFixed(2)}ms<br>
            Average time per test: ${avgTimePerTest.toFixed(2)}ms<br>
            Average memory per test: ${avgMemoryPerTest.toFixed(2)} KB<br>
            Tests run: ${results.length}
        </div>`;

        // Individual test results
        results.forEach((result) => {
            html += this.renderTestResult(result);
        });

        if (!isFinal) {
            html += `
                <div class="loading-container">
                    <div class="spinner"></div>
                    <div class="loading-text">🔄 Running tests...</div>
                </div>
            `;
        }

        DOMElements.resultsDiv.innerHTML = html;
    },

    renderTestResult(result) {
        const statusClass = result.passed ? 'pass' : 'fail';
        const statusIcon = result.passed ? '✅' : '❌';
        const consistencyIndicator = this.getConsistencyIndicator(result.cvPercent);

        let html = `<div class="test-result ${statusClass}">
            <strong>${statusIcon} Test ${result.testNumber}</strong><br>
            <strong>Input:</strong> ${this.escapeHtml(result.input)}<br>
            <strong>Expected:</strong> ${this.escapeHtml(result.expected)}<br>
            <strong>Actual:</strong> ${result.actual !== null ? this.escapeHtml(JSON.stringify(result.actual)) : 'null'}<br>
            <br>
            <strong>⏱️ Timing Statistics (${result.numRuns || 100} runs):</strong><br>
            • Mean: ${(result.executionTime * 1000000).toFixed(2)}μs<br>
            • Median: ${(result.medianTime * 1000000).toFixed(2)}μs<br>
            • Min: ${(result.minTime * 1000000).toFixed(2)}μs<br>
            • Max: ${(result.maxTime * 1000000).toFixed(2)}μs<br>
            • Std Dev: ${(result.stdDev * 1000000).toFixed(2)}μs<br>
            • Consistency (CV): ${result.cvPercent ? result.cvPercent.toFixed(2) : '0.00'}% ${consistencyIndicator}<br>
            ${result.outliersRemoved > 0 ? `• Outliers removed: ${result.outliersRemoved}<br>` : ''}
            <br>
            <strong>💾 Memory Statistics:</strong><br>
            • Mean object delta: ${result.memoryObjects || 0} objects<br>
            • Median object delta: ${result.memoryMedian || 0} objects<br>
            • Mean memory usage: ${(result.memoryBytes / 1024).toFixed(2)} KB<br>
            • Median memory usage: ${(result.memoryMedianBytes / 1024).toFixed(2)} KB<br>
            • Result size: ${(result.resultSizeBytes / 1024).toFixed(2)} KB<br>`;

        if (result.printedOutput) {
            html += `<br><strong>📝 Printed output:</strong><br><code>${this.escapeHtml(result.printedOutput)}</code><br>`;
        }

        if (result.error) {
            html += `<br><strong>❌ Error:</strong><br><code>${this.escapeHtml(result.error)}</code>`;
        }

        html += '</div>';
        return html;
    },

    getConsistencyIndicator(cvPercent) {
        if (!cvPercent) return '';
        if (cvPercent < 5) return '🟢 Excellent';
        if (cvPercent < 15) return '🟡 Good';
        return '🔴 Variable';
    },

    escapeHtml(text) {
        if (typeof text !== 'string') {
            text = String(text);
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Event handlers
function handleTestCaseChange() {
    const selectedProblem = DOMElements.testCaseSelector.value;
    TestCaseManager.loadProblem(selectedProblem);
}

function runTests() {
    TestRunner.runTests();
}

function clearResults() {
    UIManager.clearResults();
}

// Application initialization
async function initializeApp() {
    DOMElements.init();
    
    // Attach event listeners
    DOMElements.testCaseSelector.addEventListener('change', handleTestCaseChange);
    DOMElements.runBtn.addEventListener('click', runTests);
    
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearResults);
    }
    
    TestCaseManager.loadProblem('1');
    await PyodideManager.initialize();
}

// Initialize on page load
window.addEventListener('load', initializeApp);
