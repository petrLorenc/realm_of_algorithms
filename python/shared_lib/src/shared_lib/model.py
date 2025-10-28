import ast

from functools import cached_property
from typing import Callable, Sequence

import pydantic

class CodeRequest(pydantic.BaseModel):
    code: str = pydantic.Field(..., description="The code snippet to be analyzed")
    args: list[str] = pydantic.Field(default_factory=list, description="Optional arguments for the code")
    kwargs: dict[str, str] = pydantic.Field(default_factory=dict, description="Optional keyword arguments for the code")

    @pydantic.field_validator('code')
    def validate_python_code(cls, v):
        try:
            ast.parse(v)
        except SyntaxError as e:
            raise ValueError(f"Invalid Python code: {e}")
        return v
    
class MemoryMeasurement(pydantic.BaseModel):
    current_bytes: int = pydantic.Field(..., description="Current memory usage in bytes")
    peak_bytes: int = pydantic.Field(..., description="Peak memory usage in bytes")
    result_size: int = pydantic.Field(..., description="Size of the result in bytes")

class MemoryMeasurementResponse(pydantic.BaseModel):
    memory_measurements: list[MemoryMeasurement] = pydantic.Field(default_factory=list, description="List of memory measurements", exclude=True, repr=False)
    outlier_filter: Callable[[Sequence[float]], Sequence[float]] = pydantic.Field(
        default=lambda x: list(x),
        exclude=True,
        repr=False,
        description="Function to filter outliers from data"
    )

    @cached_property
    def filtered_current_bytes(self) -> Sequence[float]:
        """Current memory usage after removing outliers"""
        return self.outlier_filter([m.current_bytes for m in self.memory_measurements])

    @cached_property
    def filtered_peak_bytes(self) -> Sequence[float]:
        """Peak memory usage after removing outliers"""
        return self.outlier_filter([m.peak_bytes for m in self.memory_measurements])

    @pydantic.computed_field
    @property
    def mean_used_bytes(self) -> float:
        """Mean of current memory usage after removing outliers"""
        return sum(self.filtered_current_bytes) / len(self.filtered_current_bytes) if self.filtered_current_bytes else 0.0
    
    @pydantic.computed_field
    @property
    def median_used_bytes(self) -> float:
        """Median of current memory usage after removing outliers"""
        if not self.filtered_current_bytes:
            return 0.0
        return sorted(self.filtered_current_bytes)[len(self.filtered_current_bytes) // 2]
    
    @pydantic.computed_field
    @property
    def mean_peak_bytes(self) -> float:
        """Mean of peak memory usage after removing outliers"""
        return sum(self.filtered_peak_bytes) / len(self.filtered_peak_bytes) if self.filtered_peak_bytes else 0.0
    
    @pydantic.computed_field
    @property
    def median_peak_bytes(self) -> float:
        """Median of peak memory usage after removing outliers"""
        if not self.filtered_peak_bytes:
            return 0.0
        return sorted(self.filtered_peak_bytes)[len(self.filtered_peak_bytes) // 2]
    
    @pydantic.computed_field
    @property
    def result_size_bytes(self) -> float:
        """Average size of the result"""
        sizes = [m.result_size for m in self.memory_measurements]
        return sum(sizes) / len(sizes) if sizes else 0.0
    
class TimeMeasurementResponse(pydantic.BaseModel):
    time_measurements: list[float] = pydantic.Field(default_factory=list, description="List of time measurements", exclude=True, repr=False)
    outlier_filter: Callable[[Sequence[float]], Sequence[float]] = pydantic.Field(
        default=lambda x: list(x),
        exclude=True,
        repr=False,
        description="Function to filter outliers from data"
    )

    @cached_property
    def filtered_times(self) -> Sequence[float]:
        """Time measurements after removing outliers"""
        return self.outlier_filter(self.time_measurements)
    
    @pydantic.computed_field
    @property
    def total_time(self) -> float:
        """Total time after removing outliers"""
        return sum(self.filtered_times)

    @pydantic.computed_field
    @property
    def mean_time(self) -> float:
        """Mean time after removing outliers"""
        return sum(self.filtered_times) / len(self.filtered_times) if self.filtered_times else 0.0

    @pydantic.computed_field
    @property
    def median_time(self) -> float:
        """Median time after removing outliers"""
        if not self.filtered_times:
            return 0.0
        return sorted(self.filtered_times)[len(self.filtered_times) // 2]
    
    @pydantic.computed_field
    @property
    def min_time(self) -> float:
        """Minimum time after removing outliers"""
        return min(self.filtered_times) if self.filtered_times else 0.0
    
    @pydantic.computed_field
    @property
    def max_time(self) -> float:
        """Maximum time after removing outliers"""
        return max(self.filtered_times) if self.filtered_times else 0.0
    
    @pydantic.computed_field
    @property
    def std_dev(self) -> float:
        """Standard deviation of time after removing outliers"""
        if not self.filtered_times:
            return 0.0
        variance = sum((x - self.mean_time) ** 2 for x in self.filtered_times) / len(self.filtered_times)
        return variance ** 0.5
    
    @pydantic.computed_field
    @property
    def cv_percent(self) -> float:
        """Coefficient of variation (CV) percentage of time after removing outliers"""
        return (self.std_dev / self.mean_time * 100) if self.mean_time > 0 else 0.0


class CodeResponse(pydantic.BaseModel):
    result: object = pydantic.Field(..., description="Result of the given code. Assuming idempotent execution.")
    success: bool = pydantic.Field(False, description="Indicates if the code analysis was successful")
    time: TimeMeasurementResponse = pydantic.Field(description="Timing statistics of the code execution")
    memory: MemoryMeasurementResponse = pydantic.Field(description="Memory usage statistics of the code execution")
    error: str | None = pydantic.Field(default=None, description="Error message if the code analysis failed")

    @pydantic.model_validator(mode='after')
    def result_str(self):
        if not self.success and self.result is not None:
            self.result = str(self.result)
        return self