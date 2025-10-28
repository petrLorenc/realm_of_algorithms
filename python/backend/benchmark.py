import gc
import sys
import time
import traceback
import tracemalloc
from typing import Sequence, Callable


from shared_lib.model import CodeResponse, MemoryMeasurement, MemoryMeasurementResponse, TimeMeasurementResponse


def prepare_function_arguments(input_data) -> tuple[list, dict]:
    """Prepare function arguments based on input data type

    Args:
        input_data (object): Any input data.

    Returns:
        args: lsit, kwargs
    """
    if isinstance(input_data, list):
        args = input_data
        kwargs = {}
    elif isinstance(input_data, dict):
        args = []
        kwargs = input_data
    else:
        args = [input_data]
        kwargs = {}
    return args, kwargs


def remove_outliers(data: Sequence[float]) -> Sequence[float]:
    """Remove outliers from data using the interquartile range (IQR) method.

    Args:
        data (Iterable[Numeric]): Any numeric data.

    Returns:
        list[Numeric]: Any numeric data with outliers removed.
    """
    data_list = list(data)
    if len(data_list) < 4:
        return data_list
    sorted_data = sorted(data_list)
    n = len(sorted_data)
    q1_idx = n // 4
    q3_idx = 3 * n // 4
    q1 = sorted_data[q1_idx]
    q3 = sorted_data[q3_idx]
    iqr = q3 - q1
    lower_bound: float = q1 - 1.5 * iqr
    upper_bound: float = q3 + 1.5 * iqr
    filtered = [x for x in data_list if lower_bound <= x <= upper_bound]
    return filtered if len(filtered) >= len(data_list) * 0.5 else data_list


def time_benchmark(
    func: Callable, args: list, kwargs: dict, num_runs: int = 100, warmup_runs: int = 10
):
    """
    Perform time benchmarking with:
    - Warm-up runs to stabilize JIT/caching
    - Multiple measurements
    - Outlier removal using IQR method
    - Statistical analysis
    """
    # Warm-up phase - let JIT and caching stabilize
    for _ in range(warmup_runs):
        _ = func(*args, **kwargs)

    # Force garbage collection before measurement
    gc.collect()

    # Measurement phase
    times = []

    for _ in range(num_runs):
        start = time.perf_counter()
        _ = func(*args, **kwargs)
        end = time.perf_counter()
        times.append(end - start)

    return TimeMeasurementResponse(
        time_measurements=times,
        outlier_filter=remove_outliers,
    )


def memory_benchmark(
    func: Callable, args: list, kwargs: dict, num_samples: int = 10
) -> MemoryMeasurementResponse:
    """
    Measure memory using multiple samples - tracking peak allocations
    """
    memory_measurements = []

    for _ in range(num_samples):
        # Force garbage collection and measure baseline
        gc.collect()
        gc.collect()

        # start measuring allocation of memory objects
        tracemalloc.start()

        # Execute function
        result = func(*args, **kwargs)

        # Get peak memory usage during function execution
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        # Try to measure the result object itself
        result_size = sys.getsizeof(result)
        # If result is a container, measure contents too
        if hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
            for item in list(result):
                result_size += sys.getsizeof(item)

        memory_measurements.append(
            MemoryMeasurement(
                current_bytes=current, peak_bytes=peak, result_size=result_size
            )
        )

        # Clean up for next iteration
        del result
        gc.collect()

    return MemoryMeasurementResponse(
        memory_measurements=memory_measurements,
        outlier_filter=remove_outliers,
    )


def run_benchmarks(
    code: str,
    input_data: object,
    num_runs: int = 100,
    warmup_runs: int = 10,
    memory_samples: int = 10,
):
    """
    Run comprehensive test with robust benchmarking
    """
    # Create a clean namespace
    namespace = {}

    # Execute the user code, most tricky part ...
    exec(code, namespace)

    func = namespace.get("solution")
    if not func:
        raise Exception(
            "No callable function found. Please define a function 'solution'"
        )

    args, kwargs = prepare_function_arguments(input_data)

    try:
        result = func(*args, **kwargs)
        # Run timing benchmark
        timing_stats = time_benchmark(func, args, kwargs, num_runs, warmup_runs)

        # Run memory benchmark
        memory_stats = memory_benchmark(func, args, kwargs, memory_samples)

        return CodeResponse(result=result, success=True, time=timing_stats, memory=memory_stats)
    except Exception as e:
        return CodeResponse(
            result=None,
            success=False,
            time=TimeMeasurementResponse(),
            memory=MemoryMeasurementResponse(),
            error=str(e) + "\\n" + traceback.format_exc(),
        )


if __name__ == "__main__":
    # Example usage
    test_code_1 = """
def solution(x):
    total = []
    for i in range(x):
        total.append(i)
    return total
"""

    test_code_2 = """
def solution(x):
    total = 0
    for i in range(x*200):
        total += i
    return total
"""
    input_value = 10000
    stats = run_benchmarks(test_code_2, input_data=input_value)
    print(stats.model_dump_json(indent=2, exclude={"result"}))
